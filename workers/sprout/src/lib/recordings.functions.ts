/**
 * Past-session recording server functions (P7.A) — in-platform playback of group
 * sessions that have ended and have a durable recording archived into roadie R2.
 * Same §02 tenancy invariant as the rest of the booking surface: brand_id is
 * NEVER input — it is the verified envelope's `activeOrgId`. A forged/foreign
 * `sessionId` resolves to "not found", never another brand's recording.
 *
 *  - `listRecordings` (gated) returns the caller's brand's ENDED group sessions
 *    that have a `recording_ref` (newest-first). A recording is visible to brand
 *    members who could have attended — same scope as `listGroupSessions`, narrowed
 *    to `status = 'ended' AND recording_ref IS NOT NULL`.
 *  - `getRecordingUrl` (gated) mints a short-lived inline roadie read URL for a
 *    recording the caller's brand owns. The ownership check
 *    (`session.brand_id === activeOrgId`) is the tenancy boundary. roadie blob I/O
 *    needs R2 (inert in local dev), so a null URL degrades to the
 *    "recording will be available once processed" note rather than a broken frame.
 *  - `archiveRecording` (gated) is the WEBHOOK/CRON target: when RealtimeKit's
 *    managed recording for a session completes, the egress handler hands us the
 *    `sessionId` + the roadie `referenceId` and we stamp
 *    `group_sessions.recording_ref` + `status = 'ended'` (scoped to the caller's
 *    brand). Audited in the same logical write. The recording bytes themselves are
 *    pushed to roadie upstream by `lib/realtime.ts`'s provisioning-gated egress
 *    path (09 §8); this fn only records the resulting reference + advances the
 *    lifecycle.
 *
 * NOTE: `lib/sessions.functions.ts` owns the session lifecycle reads/writes; this
 * module imports its row types' shape by re-declaring only the recording-relevant
 * columns and never edits that file.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { groupSessions } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { getRoadie } from "@/lib/roadie";
import { writeAudit } from "@/lib/audit";

/** A past session with an archived recording, as the playback list renders it. */
export interface RecordingView {
  sessionId: string;
  hostId: string;
  title: string;
  description: string;
  startsAt: number;
  endsAt: number;
  /** The roadie referenceId of the archived recording (drives `getRecordingUrl`). */
  recordingRef: string;
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

/**
 * Gated: the caller's brand's ended group sessions that have a durable recording
 * (`status = 'ended' AND recording_ref IS NOT NULL`), newest start first, so the
 * "Past sessions" list can offer in-platform playback. A recording is visible to
 * brand members who could have attended — the same brand scope as
 * `listGroupSessions`. brand = envelope `activeOrgId`, never input. No active org
 * → empty list (the section renders its empty state).
 */
export const listRecordings = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<RecordingView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: groupSessions.id,
        hostId: groupSessions.hostId,
        title: groupSessions.title,
        description: groupSessions.description,
        startsAt: groupSessions.startsAt,
        endsAt: groupSessions.endsAt,
        recordingRef: groupSessions.recordingRef,
      })
      .from(groupSessions)
      .where(
        and(
          eq(groupSessions.brandId, brandId),
          eq(groupSessions.status, "ended"),
          isNotNull(groupSessions.recordingRef),
        ),
      )
      .orderBy(desc(groupSessions.startsAt), desc(groupSessions.id));

    return rows.map((r) => ({
      sessionId: r.id,
      hostId: r.hostId,
      title: r.title,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      recordingRef: r.recordingRef!,
    }));
  });

const sessionIdInput = type({ sessionId: "string >= 1" });

/**
 * Gated: a short-lived signed URL for a session recording the caller's brand owns.
 * The ownership check (`brand_id === activeOrgId`) is the tenancy boundary — a
 * forged/foreign `sessionId`, or a session with no archived recording, resolves to
 * `{ url: null }`, never another brand's blob. The recording always opens inline
 * (in-platform playback). Returns `{ url: null }` when roadie is inert (local dev,
 * no R2) or the blob won't resolve, so the player degrades to the
 * "recording will be available once processed" note rather than a broken frame.
 */
export const getRecordingUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(sessionIdInput)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    // Verify the session is the caller's brand's AND has an archived recording.
    const db = createDb(env.DB);
    const session = (
      await db
        .select({ recordingRef: groupSessions.recordingRef })
        .from(groupSessions)
        .where(
          and(
            eq(groupSessions.id, data.sessionId),
            eq(groupSessions.brandId, brandId),
            isNotNull(groupSessions.recordingRef),
          ),
        )
        .limit(1)
    ).at(0);
    if (!session) return { url: null }; // not ours / no recording — no blob

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: session.recordingRef!,
        disposition: "inline",
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null };
    } catch {
      // roadie inert / failed — player falls back to the "once processed" note.
      return { url: null };
    }
  });

// ─── recording archival (webhook/cron target, envelope-scoped) ──────────────

const archiveInput = type({
  sessionId: "string >= 1",
  referenceId: "string >= 1",
});

/**
 * Gated: the webhook/cron target invoked when a RealtimeKit managed recording
 * completes. Given a `sessionId` + the roadie `referenceId` of the archived
 * recording, stamp `group_sessions.recording_ref` and advance the lifecycle to
 * `status = 'ended'` — scoped to the caller's brand (the UPDATE's `brand_id` guard
 * makes a cross-brand/forged session a silent no-op → `not_found`). The recording
 * bytes are pushed to roadie R2 upstream by `lib/realtime.ts`'s provisioning-gated
 * egress path (09 §8); this fn only records the resulting reference + advances the
 * lifecycle, then
 * audits the write. brand = envelope `activeOrgId`, never input.
 */
export const archiveRecording = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(archiveInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const res = await db
      .update(groupSessions)
      .set({ recordingRef: data.referenceId, status: "ended" })
      .where(
        and(
          eq(groupSessions.id, data.sessionId),
          eq(groupSessions.brandId, brandId),
          ne(groupSessions.status, "cancelled"),
        ),
      );
    if (!res.meta.changes) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "group_session.recording.archive",
      actorId: userId,
      targetType: "group_session",
      targetId: data.sessionId,
      meta: { referenceId: data.referenceId },
    });

    return { ok: true };
  });
