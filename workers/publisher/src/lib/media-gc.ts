/**
 * Media GC drain (RFC-0001 D10, INV-DEL-4). A hard delete commits the logical
 * removal + a `media_gc_outbox` row in one batch; this sweep drains the outbox
 * by asking the `MediaStorage` port to delete the physical bytes. Because the
 * logical row is already gone, a failed or retried storage delete can never make
 * the media eligible again.
 *
 * Each row is handled independently (per-row try/catch): a `not_found` or a
 * successful delete removes the outbox row; an `unavailable` result (or a thrown
 * error) increments `attempts`, records `last_error`, and pushes
 * `next_attempt_at` out on an exponential backoff so a wedged storage backend
 * cannot starve the rest of the queue.
 */
import { and, asc, eq, lte } from "drizzle-orm";

import type { PublisherDb } from "../public/reads";
import * as schema from "../schema";
import type { MediaStorage } from "./media-storage";

const { mediaGcOutbox } = schema;

const DEFAULT_BATCH_SIZE = 25;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

export interface MediaGcDeps {
  db: PublisherDb;
  /** The physical byte sink — only `delete` is used by the drain. */
  storage: Pick<MediaStorage, "delete">;
  /** Injected clock (tests pin it); defaults to `Date.now`. */
  now?: () => number;
  /** Rows drained per sweep. Defaults to 25. */
  batchSize?: number;
}

export interface MediaGcResult {
  claimed: number;
  removed: number;
  deferred: number;
}

/** Exponential backoff for a failed byte delete: base on the first retry,
 *  doubling each further attempt, capped at six hours. */
function backoffDelay(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
}

/** Drain one batch of due outbox rows. Returns per-sweep counters. */
export async function drainMediaGc(deps: MediaGcDeps): Promise<MediaGcResult> {
  const now = deps.now?.() ?? Date.now();
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;

  const rows = await deps.db
    .select()
    .from(mediaGcOutbox)
    .where(lte(mediaGcOutbox.nextAttemptAt, now))
    .orderBy(asc(mediaGcOutbox.nextAttemptAt))
    .limit(batchSize);

  let removed = 0;
  let deferred = 0;
  for (const row of rows) {
    let ok = false;
    let lastError: string | null = null;
    try {
      const res = await deps.storage.delete({ key: row.storageKey });
      // A gone reference is as good as deleted — the logical record is already
      // removed, so absence at the storage layer settles the outbox row too.
      if (res.ok) {
        ok = true;
      } else if (res.error === "not_found") {
        ok = true;
      } else {
        lastError = res.error;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (ok) {
      await deps.db.delete(mediaGcOutbox).where(eq(mediaGcOutbox.id, row.id));
      removed += 1;
    } else {
      const attempts = row.attempts + 1;
      await deps.db
        .update(mediaGcOutbox)
        .set({ attempts, nextAttemptAt: now + backoffDelay(attempts), lastError })
        .where(and(eq(mediaGcOutbox.id, row.id), eq(mediaGcOutbox.attempts, row.attempts)));
      deferred += 1;
    }
  }

  return { claimed: rows.length, removed, deferred };
}
