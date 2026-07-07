/**
 * Group-chat server functions (P3.C). ONE persistent room per brand: the
 * `chat_rooms` table is keyed UNIQUE(brand_id), and the GroupChatRoom DO instance
 * is `idFromName(brandId)` (see `lib/room.ts` + `room-server.ts`). D1 is the
 * durable log; the DO is a pure live relay. The send path is a gated server fn —
 * NEVER over the socket — that writes `chat_messages` then calls `fanoutToRoom`
 * with the canonical `message` frame; the socket carries only receive + typing.
 *
 * Every fn is gated by `requireUserMiddleware`. brand_id is ALWAYS the verified
 * envelope's `activeOrgId`, never input — a forged room/message id from another
 * brand resolves to "not found". The brand-team marker (`chat_messages.team`) is
 * derived SERVER-SIDE from the caller's BA org role (owner|admin), never trusted
 * from input. Messages soft-delete via `deleted_at` (author own / admin any);
 * there is no hard-delete path. The author name snapshots the caller's actor
 * (name → email → "Budtender"); the store is a nullable snapshot (the actor
 * carries none today, so it stays null until a surface supplies one).
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { chatMessages, chatRooms } from "@/schema";
import { requireBrandAudience } from "@/lib/middleware/auth";
import { assertBrandAdmin, getCallerOrgRole } from "@/lib/runtime.server";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import { fanoutToRoom, roomName } from "@/lib/room";

/** A chat message as the room view renders it. `mine` flags the caller's own row. */
export interface ChatMessageView {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  /** Brand-team marker — server-derived from the author's org role, never input. */
  team: boolean;
  createdAt: number;
  /** True iff this is the caller's own message (drives the delete affordance). */
  mine: boolean;
}

/** A page of room history (oldest-first), with a cursor for scroll-up paging. */
export interface ChatHistory {
  messages: ChatMessageView[];
  /** The id to page before next (the oldest row returned); null when no rows. */
  oldestId: string | null;
  /** True when this page reached the start of the log (no older rows exist). */
  reachedStart: boolean;
}

// The typed (camelCase) projection Drizzle returns for a chat message row.
interface ChatMessageRow {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  team: number;
  createdAt: number;
}

function mapView(row: ChatMessageRow, callerId: string): ChatMessageView {
  return {
    id: row.id,
    userId: row.userId,
    authorName: row.authorName,
    body: row.body,
    team: row.team === 1,
    createdAt: row.createdAt,
    mine: row.userId === callerId,
  };
}

const HISTORY_PAGE_SIZE = 50;

/**
 * Get-or-create the brand's single chat room and return its id. The
 * UNIQUE(brand_id) index makes this idempotent: `ON CONFLICT(brand_id)` is a
 * no-op touch so concurrent callers converge on one row. brand = envelope
 * `activeOrgId`, never input. Used internally by `sendMessage` (and exposed so
 * the section can warm the room) — not an admin mutation, so no audit.
 */
async function ensureRoomId(brandId: string): Promise<string> {
  const db = createDb(env.DB);
  const existing = (
    await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(eq(chatRooms.brandId, brandId))
      .limit(1)
  ).at(0);
  if (existing) return existing.id;

  const roomId = ulid();
  await db
    .insert(chatRooms)
    .values({
      id: roomId,
      brandId,
      title: "Group Chat",
      createdAt: Date.now(),
      archivedAt: null,
    })
    .onConflictDoNothing({ target: chatRooms.brandId });

  // Re-read: on a lost INSERT race the conflicting row's id is the canonical one.
  const row = (
    await db
      .select({ id: chatRooms.id })
      .from(chatRooms)
      .where(eq(chatRooms.brandId, brandId))
      .limit(1)
  ).at(0);
  return row?.id ?? roomId;
}

/**
 * Gated: get-or-create the caller's brand chat room and return its id. brand =
 * envelope `activeOrgId`, never input. Idempotent via the UNIQUE(brand_id) index.
 */
export const ensureRoom = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<{ roomId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    return { roomId: await ensureRoomId(brandId) };
  });

const historyInput = type({
  "beforeId?": "string >= 1",
  "limit?": "1 <= number.integer <= 100",
});

/**
 * Gated: a page of the brand's chat history, oldest-first, for the no-socket
 * fallback + scroll-up paging. Returns non-deleted `chat_messages` for the
 * caller's brand. Without `beforeId` it returns the LATEST page (the newest
 * `limit` rows, re-ordered oldest-first); with `beforeId` it returns the page of
 * rows strictly OLDER than that id (keyset on the ULID, which is time-ordered).
 * brand = envelope `activeOrgId`, never input — another brand's log is unreachable.
 */
export const getRoomHistory = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(historyInput)
  .handler(async ({ data, context }): Promise<ChatHistory> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const limit = data.limit ?? HISTORY_PAGE_SIZE;
    const db = createDb(env.DB);
    // Fetch newest-first (optionally before a cursor), then reverse to oldest-first
    // so the client appends in chronological order. ULIDs sort by creation time,
    // so `id <` is a stable keyset cursor that ties-break `created_at` cleanly.
    const where = data.beforeId
      ? and(
          eq(chatMessages.brandId, brandId),
          isNull(chatMessages.deletedAt),
          lt(chatMessages.id, data.beforeId),
        )
      : and(eq(chatMessages.brandId, brandId), isNull(chatMessages.deletedAt));
    const result = await db
      .select({
        id: chatMessages.id,
        userId: chatMessages.userId,
        authorName: chatMessages.authorName,
        body: chatMessages.body,
        team: chatMessages.team,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(where)
      .orderBy(desc(chatMessages.id))
      .limit(limit);

    const rows = result.slice().reverse();
    const messages = rows.map((r) => mapView(r, userId));
    return {
      messages,
      oldestId: messages[0]?.id ?? null,
      reachedStart: rows.length < limit,
    };
  });

const sendMessageInput = type({
  body: "1 <= string <= 2000",
});

/**
 * Gated: post a message to the caller's brand chat room. The authoritative send
 * path — persists to D1 (the durable log) FIRST, then fans the live `message`
 * frame out to every connected socket via the DO RPC. The brand-team marker is
 * derived server-side from the caller's BA org role (owner|admin → team), NEVER
 * trusted from input. Author name snapshots `actor.name → email → "Budtender"`;
 * store is a nullable snapshot (none on the actor today). Emits a `chat_message`
 * event. brand = envelope `activeOrgId`, never input. The fanout is best-effort
 * (a relay failure never fails the committed write — clients reconcile from the
 * durable log on reconnect).
 */
export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(sendMessageInput)
  .handler(async ({ data, context }): Promise<{ ok: true; message: ChatMessageView }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actor = context.principal.actor;
    const userId = actor.id;

    const roomId = await ensureRoomId(brandId);

    // Brand-team marker: server-derived from the caller's org role, never input.
    const role = await getCallerOrgRole(brandId);
    const team = role === "owner" || role === "admin";

    const authorName = (actor.name ?? actor.email ?? "Budtender").trim() || "Budtender";
    const body = data.body.trim();
    const id = ulid();
    const createdAt = Date.now();

    const db = createDb(env.DB);
    await db.insert(chatMessages).values({
      id,
      roomId,
      brandId,
      userId,
      authorName,
      store: null,
      body,
      team: team ? 1 : 0,
      createdAt,
      deletedAt: null,
    });

    await emitEvent({
      brandId,
      actorId: userId,
      type: "chat_message",
      targetType: "chat_room",
      targetId: roomId,
    });

    // Live relay AFTER the durable write commits. Frame shape mirrors the DO's
    // `session.init` message rows so the client appends them identically.
    await fanoutToRoom(roomName(brandId), {
      type: "message",
      id,
      userId,
      authorName,
      body,
      team,
      createdAt,
    });

    return {
      ok: true,
      message: { id, userId, authorName, body, team, createdAt, mine: true },
    };
  });

const deleteMessageInput = type({ messageId: "string >= 1" });

/**
 * Gated: SOFT-delete a chat message (sets `deleted_at`; never a hard DELETE). The
 * author may remove their OWN message; a Brand Admin may remove ANY message in
 * the brand. The `brand_id` guard scopes the write so neither path can reach
 * across tenants; a foreign/unknown id is a no-op → 404. An admin removing
 * someone else's message writes a `chat.delete` audit row (the author removing
 * their own does not). Fans a `delete` frame out so live clients drop the row.
 * brand = envelope `activeOrgId`, never input.
 */
export const deleteMessage = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(deleteMessageInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;

    const db = createDb(env.DB);
    const target = (
      await db
        .select({ userId: chatMessages.userId, deletedAt: chatMessages.deletedAt })
        .from(chatMessages)
        .where(and(eq(chatMessages.id, data.messageId), eq(chatMessages.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!target) throw new Error("not_found");

    const isOwn = target.userId === actorId;
    // Authorize: own message OR brand-admin. Non-owners must pass the admin gate.
    if (!isOwn) {
      await assertBrandAdmin(brandId, context.principal.actor.role);
    }

    // Idempotent: an already-deleted row is a no-op (no second audit / fanout).
    if (target.deletedAt !== null) return { ok: true };

    await db
      .update(chatMessages)
      .set({ deletedAt: Date.now() })
      .where(
        and(
          eq(chatMessages.id, data.messageId),
          eq(chatMessages.brandId, brandId),
          isNull(chatMessages.deletedAt),
        ),
      );

    // Only an admin removing ANOTHER user's message is an auditable moderation act.
    if (!isOwn) {
      await writeAudit({
        brandId,
        action: "chat.delete",
        actorId,
        targetType: "chat_message",
        targetId: data.messageId,
        meta: { authorId: target.userId },
      });
    }

    await fanoutToRoom(roomName(brandId), { type: "delete", id: data.messageId });

    return { ok: true };
  });
