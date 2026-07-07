/**
 * Booking + group-session server functions (P4.C). BOOKING ONLY — there is NO
 * instant-call path anywhere (no startCall / joinNow). A 1:1 slot or a group
 * session is always scheduled first; the Join action is a COMPUTED gate
 * (`now >= startsAt`), never a stored `join_at`. Same §02 tenancy invariant as
 * the rest of the platform: brand_id is NEVER input — it is the verified
 * envelope's `activeOrgId`. A forged windowId/sessionId from another brand
 * resolves to "not found", never another brand's row.
 *
 *  - The budtender reads (`listSlots`, `listGroupSessions`) gate with
 *    `requireUserMiddleware` and scope every row to `activeOrgId`. `listSlots`
 *    derives bookable 1:1 slots from `availability_windows` (isGroup=0) minus the
 *    already-booked `bookings` (the slot UNIQUE makes a booked slot vanish).
 *  - The budtender writes (`bookCall`, `cancelBooking`, `registerSession`,
 *    `joinSession`, `leaveSession`) are gated but NOT admin-gated — any signed-in
 *    budtender books, cancels their own booking, registers, joins, and leaves.
 *    `bookCall` denormalizes `host_id` from the window and relies on the slot
 *    UNIQUE to surface a `slot_taken` race. `joinSession` lazily mints the
 *    realtime room (lib/realtime) ONLY when `now >= startsAt`.
 *  - The ADMIN mutations (`upsertAvailabilityWindow`, `upsertGroupSession`)
 *    additionally gate IN-HANDLER on `decideBrandAdmin` + `writeAudit`.
 *
 * Notifications reach the budtender via the in-platform channel (lib/notify —
 * `session_reminder`); analytics fire via lib/analytics
 * (`booking_created` / `session_register` / `session_join`). RealtimeKit is inert
 * in local dev: `joinSession` still stamps `joined_at` and the room renders the
 * "provision RealtimeKit" placeholder rather than crashing.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { availabilityWindows, bookings, groupSessions, sessionAttendance } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import { createRealtimeSession, mintJoinToken } from "@/lib/realtime";

/** A bookable 1:1 slot derived from an availability window (still open). */
export interface BookableSlot {
  windowId: string;
  hostId: string;
  startsAt: number;
  endsAt: number;
}

/** One of the caller's own 1:1 bookings (the "my upcoming calls" list). */
export interface MyBooking {
  id: string;
  hostId: string;
  startsAt: number;
  endsAt: number;
  status: string;
  realtimeSessionId: string | null;
}

/** A group session as the budtender list renders it (with the caller's state). */
export interface GroupSessionView {
  id: string;
  hostId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  capacity: number | null;
  status: string;
  /** Headcount of registered attendees (drives the capacity-full affordance). */
  registeredCount: number;
  /** True iff the caller has registered (drives Register ↔ Join). */
  registered: boolean;
  /** Stamped once the caller has joined (drives Leave). */
  joinedAt: number | null;
}

/** The admin projection of an availability window. */
export interface AdminWindowView {
  id: string;
  hostId: string;
  startsAt: number;
  endsAt: number;
  slotMinutes: number;
  isGroup: boolean;
  capacity: number;
  createdAt: number;
}

/** The admin projection of a group session. */
export interface AdminGroupSessionView {
  id: string;
  hostId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  capacity: number | null;
  status: string;
  recordingRef: string | null;
  realtimeSessionId: string | null;
  createdAt: number;
}

/** The room handle the call surface mounts (token null ⇒ render the placeholder). */
export interface RoomHandle {
  realtimeSessionId: string | null;
  /** Short-lived participant token, or null when RealtimeKit is inert (local dev). */
  token: string | null;
  /** False ⇒ the room shows the "provision RealtimeKit" placeholder, never a crash. */
  available: boolean;
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

/**
 * Gated: the caller's brand's bookable 1:1 slots, derived from future,
 * non-group (`is_group = 0`) availability windows minus every slot already taken
 * in `bookings` (status='booked'). Each window is sliced into `slot_minutes`
 * chunks across `[starts_at, ends_at)`; a slot whose `(window_id, slot_starts_at)`
 * is already booked VANISHES (the slot UNIQUE is the single-use guarantee).
 * Only slots starting in the future are offered. brand = envelope `activeOrgId`,
 * never input. No active org → empty list.
 */
export const listSlots = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<BookableSlot[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const now = Date.now();
    const [windowRows, bookedRows] = await Promise.all([
      db
        .select({
          id: availabilityWindows.id,
          hostId: availabilityWindows.hostId,
          startsAt: availabilityWindows.startsAt,
          endsAt: availabilityWindows.endsAt,
          slotMinutes: availabilityWindows.slotMinutes,
        })
        .from(availabilityWindows)
        .where(
          and(
            eq(availabilityWindows.brandId, brandId),
            eq(availabilityWindows.isGroup, 0),
            sql`${availabilityWindows.endsAt} > ${now}`,
          ),
        )
        .orderBy(availabilityWindows.startsAt, availabilityWindows.id),
      db
        .select({
          windowId: bookings.windowId,
          slotStartsAt: bookings.slotStartsAt,
        })
        .from(bookings)
        .where(and(eq(bookings.brandId, brandId), eq(bookings.status, "booked"))),
    ]);

    // Set of taken "<windowId>:<slotStartsAt>" keys — a booked slot vanishes.
    const taken = new Set(bookedRows.map((b) => `${b.windowId}:${b.slotStartsAt}`));

    const slots: BookableSlot[] = [];
    for (const w of windowRows) {
      const stepMs = Math.max(1, w.slotMinutes) * 60_000;
      for (let start = w.startsAt; start + stepMs <= w.endsAt; start += stepMs) {
        if (start < now) continue; // only future slots are bookable
        if (taken.has(`${w.id}:${start}`)) continue; // already booked → vanish
        slots.push({
          windowId: w.id,
          hostId: w.hostId,
          startsAt: start,
          endsAt: start + stepMs,
        });
      }
    }
    return slots;
  });

/**
 * Gated: the caller's own 1:1 bookings (booked|completed), newest start first,
 * so the "my upcoming calls" list can render a Join gate (`now >= startsAt`) per
 * row. Cancelled bookings are excluded. brand = envelope `activeOrgId`, never
 * input.
 */
export const listMyBookings = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<MyBooking[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: bookings.id,
        hostId: bookings.hostId,
        startsAt: bookings.slotStartsAt,
        endsAt: bookings.slotEndsAt,
        status: bookings.status,
        realtimeSessionId: bookings.realtimeSessionId,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.brandId, brandId),
          eq(bookings.userId, userId),
          ne(bookings.status, "cancelled"),
        ),
      )
      .orderBy(sql`${bookings.slotStartsAt} DESC`, sql`${bookings.id} DESC`);

    return rows;
  });

/**
 * Gated: the caller's brand's group sessions (scheduled|live|ended), each with a
 * registered headcount and the caller's own registration/joined state, so the
 * list can drive Register → Join (computed `now >= startsAt`) → the call room.
 * Cancelled sessions are excluded. Newest start first. brand = envelope
 * `activeOrgId`, never input. No active org → empty list.
 */
export const listGroupSessions = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<GroupSessionView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: groupSessions.id,
        hostId: groupSessions.hostId,
        title: groupSessions.title,
        description: groupSessions.description,
        startsAt: groupSessions.startsAt,
        endsAt: groupSessions.endsAt,
        capacity: groupSessions.capacity,
        status: groupSessions.status,
      })
      .from(groupSessions)
      .where(and(eq(groupSessions.brandId, brandId), ne(groupSessions.status, "cancelled")))
      .orderBy(sql`${groupSessions.startsAt} DESC`, sql`${groupSessions.id} DESC`);
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [countsRows, mineRows] = await Promise.all([
      db
        .select({
          sessionId: sessionAttendance.sessionId,
          n: count(),
        })
        .from(sessionAttendance)
        .where(inArray(sessionAttendance.sessionId, ids))
        .groupBy(sessionAttendance.sessionId),
      db
        .select({
          sessionId: sessionAttendance.sessionId,
          joinedAt: sessionAttendance.joinedAt,
        })
        .from(sessionAttendance)
        .where(
          and(eq(sessionAttendance.userId, userId), inArray(sessionAttendance.sessionId, ids)),
        ),
    ]);

    const counts = new Map(countsRows.map((c) => [c.sessionId, c.n]));
    const mine = new Map(mineRows.map((m) => [m.sessionId, m.joinedAt]));

    return rows.map((r) => ({
      id: r.id,
      hostId: r.hostId,
      title: r.title,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      capacity: r.capacity,
      status: r.status,
      registeredCount: counts.get(r.id) ?? 0,
      registered: mine.has(r.id),
      joinedAt: mine.get(r.id) ?? null,
    }));
  });

// ─── budtender writes (gated, envelope-scoped) ──────────────────────────────

const bookCallInput = type({
  windowId: "string >= 1",
  slotStartsAt: "number >= 0",
  "note?": "string",
});

/**
 * Gated: book a 1:1 slot. Resolves the window (must be the caller's brand's,
 * non-group), validates the requested `slotStartsAt` falls on a real slot
 * boundary inside the window, denormalizes `host_id` from the window, and INSERTs
 * a `bookings` row (status='booked'). The `(window_id, slot_starts_at)` UNIQUE is
 * the single-use guarantee — a concurrent booker losing the race surfaces as
 * `slot_taken` (the slot then vanishes from `listSlots`). Emits a
 * `booking_created` event. brand = envelope `activeOrgId`, never input.
 */
export const bookCall = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(bookCallInput)
  .handler(async ({ data, context }): Promise<{ ok: true; bookingId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const window = (
      await db
        .select({
          id: availabilityWindows.id,
          hostId: availabilityWindows.hostId,
          startsAt: availabilityWindows.startsAt,
          endsAt: availabilityWindows.endsAt,
          slotMinutes: availabilityWindows.slotMinutes,
        })
        .from(availabilityWindows)
        .where(
          and(
            eq(availabilityWindows.id, data.windowId),
            eq(availabilityWindows.brandId, brandId),
            eq(availabilityWindows.isGroup, 0),
          ),
        )
        .limit(1)
    ).at(0);
    if (!window) throw new Error("not_found");

    // The requested slot must align to a real boundary inside the window and be
    // in the future (no booking a slot that's already begun).
    const stepMs = Math.max(1, window.slotMinutes) * 60_000;
    const offset = data.slotStartsAt - window.startsAt;
    const slotEndsAt = data.slotStartsAt + stepMs;
    const aligned = offset >= 0 && offset % stepMs === 0 && slotEndsAt <= window.endsAt;
    if (!aligned || data.slotStartsAt < Date.now()) throw new Error("invalid_slot");

    const bookingId = ulid();
    const note = (data.note ?? "").trim() || null;
    try {
      await db.insert(bookings).values({
        id: bookingId,
        brandId,
        windowId: window.id,
        hostId: window.hostId, // denormalized from the window
        userId,
        slotStartsAt: data.slotStartsAt,
        slotEndsAt,
        status: "booked",
        note,
        realtimeSessionId: null,
        createdAt: Date.now(),
      });
    } catch (e) {
      // The slot UNIQUE rejected the insert — someone else took it first.
      const msg = e instanceof Error ? e.message : "";
      if (/UNIQUE|constraint/i.test(msg)) throw new Error("slot_taken");
      throw e instanceof Error ? e : new Error("book_failed");
    }

    await emitEvent({
      brandId,
      actorId: userId,
      type: "booking_created",
      targetType: "booking",
      targetId: bookingId,
      metadata: { windowId: window.id, hostId: window.hostId, startsAt: data.slotStartsAt },
    });

    return { ok: true, bookingId };
  });

const bookingIdInput = type({ bookingId: "string >= 1" });

/**
 * Gated: cancel the caller's own 1:1 booking. Flips status='cancelled', which
 * FREES the slot (cancelled rows are excluded from the `listSlots` taken-set, so
 * the slot reappears as bookable). A forged/foreign booking, or one not owned by
 * the caller, is a no-op → not_found. brand = envelope `activeOrgId`, never input.
 */
export const cancelBooking = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(bookingIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const res = await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bookings.id, data.bookingId),
          eq(bookings.brandId, brandId),
          eq(bookings.userId, userId),
          eq(bookings.status, "booked"),
        ),
      );
    if (!res.meta.changes) throw new Error("not_found");

    return { ok: true };
  });

const sessionIdInput = type({ sessionId: "string >= 1" });

/**
 * Gated: register the caller for a group session. INSERT OR IGNORE the
 * `(session_id, user_id)` attendance row (the UNIQUE makes a repeat call
 * idempotent) stamping `registered_at`. Capacity is honoured: a session at its
 * `capacity` headcount rejects new registrations with `session_full` (an already-
 * registered caller is a no-op). Emits a `session_register` event on a fresh
 * registration only. brand = envelope `activeOrgId`; the session must be the
 * caller's brand's and not cancelled.
 */
export const registerSession = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(sessionIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true; registered: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const session = (
      await db
        .select({ id: groupSessions.id, capacity: groupSessions.capacity })
        .from(groupSessions)
        .where(
          and(
            eq(groupSessions.id, data.sessionId),
            eq(groupSessions.brandId, brandId),
            ne(groupSessions.status, "cancelled"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!session) throw new Error("not_found");

    // Already registered? Idempotent no-op (don't re-emit, don't re-check cap).
    const existing = (
      await db
        .select({ id: sessionAttendance.id })
        .from(sessionAttendance)
        .where(
          and(
            eq(sessionAttendance.sessionId, data.sessionId),
            eq(sessionAttendance.userId, userId),
          ),
        )
        .limit(1)
    ).at(0);
    if (existing) return { ok: true, registered: true };

    // Honour capacity (null ⇒ unbounded) against the live headcount.
    if (session.capacity != null) {
      const countRow = (
        await db
          .select({ n: count() })
          .from(sessionAttendance)
          .where(eq(sessionAttendance.sessionId, data.sessionId))
      ).at(0);
      if ((countRow?.n ?? 0) >= session.capacity) throw new Error("session_full");
    }

    await db
      .insert(sessionAttendance)
      .values({
        id: ulid(),
        brandId,
        sessionId: data.sessionId,
        userId,
        registeredAt: Date.now(),
        joinedAt: null,
        leftAt: null,
      })
      .onConflictDoNothing();

    await emitEvent({
      brandId,
      actorId: userId,
      type: "session_register",
      targetType: "group_session",
      targetId: data.sessionId,
    });

    return { ok: true, registered: true };
  });

/**
 * Gated: join a group session's call room. The Join action is a COMPUTED gate —
 * only allowed once `now >= group_sessions.starts_at` (there is NO `join_at`
 * column and NO instant-call path). The caller must already be registered. On the
 * FIRST join the realtime room is minted lazily via `lib/realtime`
 * (`createRealtimeSession`) and stored on `group_sessions.realtime_session_id`;
 * subsequent joins reuse it. `session_attendance.joined_at` is stamped (once) and
 * a `session_join` event fires. A per-participant token is minted per join. When
 * RealtimeKit is inert (local dev) the room id/token are null and the surface
 * renders the "provision RealtimeKit" placeholder — joined_at still stamps, the
 * call NEVER crashes. brand = envelope `activeOrgId`, never input.
 */
export const joinSession = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(sessionIdInput)
  .handler(async ({ data, context }): Promise<RoomHandle> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const session = (
      await db
        .select({
          id: groupSessions.id,
          hostId: groupSessions.hostId,
          title: groupSessions.title,
          startsAt: groupSessions.startsAt,
          realtimeSessionId: groupSessions.realtimeSessionId,
        })
        .from(groupSessions)
        .where(
          and(
            eq(groupSessions.id, data.sessionId),
            eq(groupSessions.brandId, brandId),
            ne(groupSessions.status, "cancelled"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!session) throw new Error("not_found");

    // Computed gate: no joining before the scheduled start (no join_at column).
    if (Date.now() < session.startsAt) throw new Error("not_started");

    // Must already be registered (capacity was honoured at registration).
    const attendance = (
      await db
        .select({ joinedAt: sessionAttendance.joinedAt })
        .from(sessionAttendance)
        .where(
          and(
            eq(sessionAttendance.sessionId, data.sessionId),
            eq(sessionAttendance.userId, userId),
          ),
        )
        .limit(1)
    ).at(0);
    if (!attendance) throw new Error("not_registered");

    // Lazily mint the realtime room on first join; reuse it thereafter. roadie/
    // RealtimeKit inert locally ⇒ realtimeSessionId stays null (placeholder room).
    let realtimeSessionId = session.realtimeSessionId;
    if (!realtimeSessionId) {
      const created = await createRealtimeSession({
        brandId,
        title: session.title,
        record: true,
      });
      if (created.available) {
        realtimeSessionId = created.sessionId;
        await db
          .update(groupSessions)
          .set({ realtimeSessionId })
          .where(and(eq(groupSessions.id, data.sessionId), eq(groupSessions.brandId, brandId)));
      }
    }

    // Stamp joined_at once (first join wins) + emit the join event then.
    if (attendance.joinedAt == null) {
      await db
        .update(sessionAttendance)
        .set({ joinedAt: Date.now() })
        .where(
          and(
            eq(sessionAttendance.sessionId, data.sessionId),
            eq(sessionAttendance.userId, userId),
            sql`${sessionAttendance.joinedAt} IS NULL`,
          ),
        );
      await emitEvent({
        brandId,
        actorId: userId,
        type: "session_join",
        targetType: "group_session",
        targetId: data.sessionId,
      });
    }

    // Mint a short-lived participant token (null when RealtimeKit is inert).
    let token: string | null = null;
    if (realtimeSessionId) {
      const minted = await mintJoinToken(realtimeSessionId, userId);
      if (minted.available) token = minted.token;
    }

    return { realtimeSessionId, token, available: token != null };
  });

/**
 * Gated: leave a group session's call room. Stamps `left_at` and returns the
 * computed `durationSeconds` (left_at − joined_at) for the engagement signal. A
 * caller who never joined, or whose row already left, is a no-op (duration 0).
 * brand = envelope `activeOrgId`, never input.
 */
export const leaveSession = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(sessionIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true; durationSeconds: number }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const attendance = (
      await db
        .select({
          joinedAt: sessionAttendance.joinedAt,
          leftAt: sessionAttendance.leftAt,
        })
        .from(sessionAttendance)
        .where(
          and(
            eq(sessionAttendance.sessionId, data.sessionId),
            eq(sessionAttendance.userId, userId),
            eq(sessionAttendance.brandId, brandId),
          ),
        )
        .limit(1)
    ).at(0);
    if (!attendance || attendance.joinedAt == null || attendance.leftAt != null) {
      return { ok: true, durationSeconds: 0 }; // never joined / already left — no-op
    }

    const now = Date.now();
    await db
      .update(sessionAttendance)
      .set({ leftAt: now })
      .where(
        and(
          eq(sessionAttendance.sessionId, data.sessionId),
          eq(sessionAttendance.userId, userId),
          sql`${sessionAttendance.leftAt} IS NULL`,
        ),
      );

    const durationSeconds = Math.max(0, Math.round((now - attendance.joinedAt) / 1000));
    return { ok: true, durationSeconds };
  });

// ─── admin mutations (brand-role gated, in-handler decideBrandAdmin) ────────

/**
 * Admin: the full set of availability windows for the management table. brand =
 * envelope `activeOrgId`, never input. Brand-role gated. Newest start first.
 */
export const listAdminWindows = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminWindowView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: availabilityWindows.id,
        hostId: availabilityWindows.hostId,
        startsAt: availabilityWindows.startsAt,
        endsAt: availabilityWindows.endsAt,
        slotMinutes: availabilityWindows.slotMinutes,
        isGroup: availabilityWindows.isGroup,
        capacity: availabilityWindows.capacity,
        createdAt: availabilityWindows.createdAt,
      })
      .from(availabilityWindows)
      .where(eq(availabilityWindows.brandId, brandId))
      .orderBy(sql`${availabilityWindows.startsAt} DESC`, sql`${availabilityWindows.id} DESC`);

    return rows.map((r) => ({
      id: r.id,
      hostId: r.hostId,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      slotMinutes: r.slotMinutes,
      isGroup: r.isGroup !== 0,
      capacity: r.capacity,
      createdAt: r.createdAt,
    }));
  });

/**
 * Admin: the full set of group sessions for the management table (incl.
 * cancelled). brand = envelope `activeOrgId`, never input. Brand-role gated.
 * Newest start first.
 */
export const listAdminGroupSessions = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminGroupSessionView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: groupSessions.id,
        hostId: groupSessions.hostId,
        title: groupSessions.title,
        description: groupSessions.description,
        startsAt: groupSessions.startsAt,
        endsAt: groupSessions.endsAt,
        capacity: groupSessions.capacity,
        recordingRef: groupSessions.recordingRef,
        realtimeSessionId: groupSessions.realtimeSessionId,
        status: groupSessions.status,
        createdAt: groupSessions.createdAt,
      })
      .from(groupSessions)
      .where(eq(groupSessions.brandId, brandId))
      .orderBy(sql`${groupSessions.startsAt} DESC`, sql`${groupSessions.id} DESC`);

    return rows.map((r) => ({
      id: r.id,
      hostId: r.hostId,
      title: r.title,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      capacity: r.capacity,
      status: r.status,
      recordingRef: r.recordingRef,
      realtimeSessionId: r.realtimeSessionId,
      createdAt: r.createdAt,
    }));
  });

const upsertWindowInput = type({
  "windowId?": "string >= 1",
  "hostId?": "string >= 1",
  startsAt: "number >= 0",
  endsAt: "number >= 0",
  "slotMinutes?": "number >= 1",
  isGroup: "boolean",
  "capacity?": "number >= 1",
});

/**
 * Admin: create or edit an availability window. Without `windowId` it INSERTs;
 * with one it UPDATEs the caller's brand's window (the `brand_id` guard makes a
 * cross-brand edit a no-op → 404). `host_id` defaults to the caller when not
 * supplied (the admin hosts their own slots). `isGroup=0` windows feed 1:1
 * `listSlots`; `isGroup=1` windows are the group-availability source. brand =
 * envelope `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const upsertAvailabilityWindow = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertWindowInput)
  .handler(async ({ data, context }): Promise<{ ok: true; windowId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    if (data.endsAt <= data.startsAt) throw new Error("invalid_window");

    const hostId = data.hostId?.trim() || userId;
    const slotMinutes = data.slotMinutes ?? 30;
    const isGroup = data.isGroup ? 1 : 0;
    const capacity = data.capacity ?? 1;

    const db = createDb(env.DB);
    if (data.windowId) {
      const res = await db
        .update(availabilityWindows)
        .set({
          hostId,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          slotMinutes,
          isGroup,
          capacity,
        })
        .where(
          and(eq(availabilityWindows.id, data.windowId), eq(availabilityWindows.brandId, brandId)),
        );
      if (!res.meta.changes) throw new Error("not_found");

      await writeAudit({
        brandId,
        action: "availability_window.upsert",
        actorId: userId,
        targetType: "availability_window",
        targetId: data.windowId,
        meta: { hostId, startsAt: data.startsAt, endsAt: data.endsAt, isGroup: data.isGroup },
      });
      return { ok: true, windowId: data.windowId };
    }

    const windowId = ulid();
    await db.insert(availabilityWindows).values({
      id: windowId,
      brandId,
      hostId,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      slotMinutes,
      isGroup,
      capacity,
      createdAt: Date.now(),
    });

    await writeAudit({
      brandId,
      action: "availability_window.upsert",
      actorId: userId,
      targetType: "availability_window",
      targetId: windowId,
      meta: { hostId, startsAt: data.startsAt, endsAt: data.endsAt, isGroup: data.isGroup },
    });
    return { ok: true, windowId };
  });

const upsertGroupSessionInput = type({
  "sessionId?": "string >= 1",
  "hostId?": "string >= 1",
  title: "string >= 1",
  "description?": "string",
  startsAt: "number >= 0",
  endsAt: "number >= 0",
  "capacity?": "number >= 1",
  "status?": "'scheduled' | 'cancelled'",
});

/**
 * Admin: create or edit a group session. Without `sessionId` it INSERTs
 * (status='scheduled'); with one it UPDATEs the caller's brand's session (the
 * `brand_id` guard makes a cross-brand edit a no-op → 404). The lifecycle
 * (scheduled → live → ended) is advanced by the cron pass around the start/end
 * times — the admin only sets scheduled/cancelled here (live/ended are never set
 * by hand). `host_id` defaults to the caller. brand = envelope `activeOrgId`,
 * never input. Brand-Admin gated; audited.
 */
export const upsertGroupSession = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertGroupSessionInput)
  .handler(async ({ data, context }): Promise<{ ok: true; sessionId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    if (data.endsAt <= data.startsAt) throw new Error("invalid_session");

    const hostId = data.hostId?.trim() || userId;
    const description = (data.description ?? "").trim();
    const capacity = data.capacity ?? null;
    const status = data.status ?? "scheduled";

    const db = createDb(env.DB);
    if (data.sessionId) {
      const res = await db
        .update(groupSessions)
        .set({
          hostId,
          title: data.title,
          description,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          capacity,
          status,
        })
        .where(and(eq(groupSessions.id, data.sessionId), eq(groupSessions.brandId, brandId)));
      if (!res.meta.changes) throw new Error("not_found");

      await writeAudit({
        brandId,
        action: "group_session.upsert",
        actorId: userId,
        targetType: "group_session",
        targetId: data.sessionId,
        meta: { title: data.title, startsAt: data.startsAt, status },
      });
      return { ok: true, sessionId: data.sessionId };
    }

    const sessionId = ulid();
    await db.insert(groupSessions).values({
      id: sessionId,
      brandId,
      hostId,
      title: data.title,
      description,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      capacity,
      recordingRef: null,
      realtimeSessionId: null,
      status,
      createdAt: Date.now(),
    });

    await writeAudit({
      brandId,
      action: "group_session.upsert",
      actorId: userId,
      targetType: "group_session",
      targetId: sessionId,
      meta: { title: data.title, startsAt: data.startsAt, status },
    });
    return { ok: true, sessionId };
  });
