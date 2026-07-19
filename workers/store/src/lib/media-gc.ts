// Media-GC drain (RFC-0001 D8/D10) — the async physical-byte cleanup behind the
// two-step hard delete. A logical media delete commits a `store_media_gc_outbox`
// row atomically with the row removal; this drain (a second unconditional call
// on the scheduled handler, alongside the reconcile sweep) deletes the bytes
// through the private MediaStorage port. A failed cleanup NEVER resurfaces the
// deleted logical record — it only reschedules the byte delete.
//
// The MediaStorage port is injected (like reconcile.ts's Stripe re-check), so
// the D1 drain path is drivable against a real local D1 with a stub port in the
// pool tier — no Roadie import here.
import { asc, eq, lte } from "drizzle-orm";

import { storeMediaGcOutbox } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { MediaStorage } from "@/lib/media-storage";

// Small per-run cap so one scheduled tick never fans out an unbounded storage
// call list; the backlog drains across ticks.
const DRAIN_BATCH = 25;
// Exponential backoff, capped, from the first failed attempt.
const BASE_BACKOFF_MS = 60 * 1000;
const MAX_BACKOFF_MS = 60 * 60 * 1000;

export interface MediaGcDeps {
  db: Db;
  storage: MediaStorage;
  /** Overridable clock for tests; defaults to now. */
  now?: number;
  /** Overridable per-run cap for tests; defaults to DRAIN_BATCH. */
  limit?: number;
}

export interface MediaGcResult {
  deleted: number;
  retried: number;
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/**
 * Drain due `store_media_gc_outbox` rows: for each, call the storage port's
 * delete. Success OR `not_found` (already gone) retires the outbox row; a
 * transient failure (`unavailable` or a thrown exception) bumps `attempts`,
 * records `lastError`, and pushes `nextAttemptAt` out with exponential backoff.
 * Rows whose `nextAttemptAt` is still in the future are skipped this run.
 */
export async function drainMediaGcOutbox(deps: MediaGcDeps): Promise<MediaGcResult> {
  const { db, storage } = deps;
  const nowMs = deps.now ?? Date.now();
  const now = new Date(nowMs);
  const limit = deps.limit ?? DRAIN_BATCH;

  const rows = await db
    .select()
    .from(storeMediaGcOutbox)
    .where(lte(storeMediaGcOutbox.nextAttemptAt, now))
    .orderBy(asc(storeMediaGcOutbox.nextAttemptAt))
    .limit(limit);

  let deleted = 0;
  let retried = 0;
  for (const row of rows) {
    const recordFailure = async (lastError: string) => {
      const attempts = row.attempts + 1;
      await db
        .update(storeMediaGcOutbox)
        .set({
          attempts,
          lastError: lastError.slice(0, 500),
          nextAttemptAt: new Date(nowMs + backoffMs(attempts)),
        })
        .where(eq(storeMediaGcOutbox.id, row.id));
      retried++;
    };
    try {
      const result = await storage.delete({ key: row.storageKey });
      if (result.ok || result.error === "not_found") {
        await db.delete(storeMediaGcOutbox).where(eq(storeMediaGcOutbox.id, row.id));
        deleted++;
        console.log("store.media_gc.deleted", { id: row.id, already_gone: !result.ok });
        continue;
      }
      await recordFailure(result.error);
      console.warn("store.media_gc.retry", {
        id: row.id,
        attempts: row.attempts + 1,
        error: result.error,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      await recordFailure(message);
      console.warn(`[store] media gc delete failed for ${row.id}: ${message}`);
    }
  }
  return { deleted, retried };
}
