// Pending reaper — the only scheduled task that ships in v1. Transitions
// pending blobs older than DEFAULT_PENDING_TIMER_SECONDS to deleted, enqueues
// backend removal of any partial bytes, and drops the reference rows that
// pointed at them. See spec §Scheduled tasks and RFC §13.
import { loggedJob, requireRequestLog } from "@greenroom/kit/log";
import { and, eq, isNull, lt } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { DEFAULT_PENDING_TIMER_SECONDS, PENDING_REAP_BATCH_SIZE } from "../config";
import { createDb } from "../db";
import { newId } from "../ids";
import type { RoadieEnv } from "../roadie-env";
import { blobReference, deletionQueue, physicalBlob } from "../schema";
import { abortMultipartUpload } from "../sign";

// Transitions pending physical blobs older than the pending timer to deleted,
// drops their reference rows, and enqueues removal of any partial bytes from
// R2. Bounded batch — N rows per firing (see RFC §13). With the logical
// `blob` layer gone this is a two-write flow per row: tombstone the
// physical_blob + delete the (up-to-one) reference. References cascade-delete
// when the physical row is force-deleted, but soft-delete via `deletedAt`
// doesn't trigger the cascade, so we still delete references explicitly.
export const run = loggedJob(
  {
    service: "roadie",
    operation: "roadie.job.pending_reap",
    generateRequestId: () => ulid(),
  },
  async (
    env: RoadieEnv,
    ctx: ExecutionContext,
  ): Promise<{ processed: number; durationMs: number }> => {
    const started = Date.now();
    const db = createDb(env.DB);
    const cutoff = new Date(Date.now() - DEFAULT_PENDING_TIMER_SECONDS * 1000);

    const candidates = await db
      .select({
        physicalBlobId: physicalBlob.id,
        r2UploadId: physicalBlob.r2UploadId,
      })
      .from(physicalBlob)
      .where(
        and(
          isNull(physicalBlob.finalizedAt),
          isNull(physicalBlob.deletedAt),
          lt(physicalBlob.createdAt, cutoff),
        ),
      )
      .limit(PENDING_REAP_BATCH_SIZE);

    let processed = 0;
    let backendFailures = 0;
    const now = new Date();
    for (const row of candidates) {
      await db.batch([
        db
          .update(physicalBlob)
          .set({ deletedAt: now })
          .where(eq(physicalBlob.id, row.physicalBlobId)),
        db.delete(blobReference).where(eq(blobReference.physicalBlobId, row.physicalBlobId)),
      ]);

      if (row.r2UploadId) {
        ctx.waitUntil(
          abortMultipartUpload(env, row.physicalBlobId, row.r2UploadId).catch(
            async (e: unknown) => {
              backendFailures++;
              await recordFailure(env, row.physicalBlobId, e);
            },
          ),
        );
      } else {
        ctx.waitUntil(
          env.BLOBS.delete(row.physicalBlobId).catch(async (e: unknown) => {
            backendFailures++;
            await recordFailure(env, row.physicalBlobId, e);
          }),
        );
      }
      processed++;
    }

    const durationMs = Date.now() - started;
    const log = requireRequestLog();
    log.add({ processed, batch_size: PENDING_REAP_BATCH_SIZE });
    if (backendFailures > 0) {
      log.add({ backend_failures: backendFailures });
      log.outcome("partial_failure");
    }
    return { processed, durationMs };
  },
);

async function recordFailure(env: RoadieEnv, physicalBlobId: string, e: unknown): Promise<void> {
  const message = e instanceof Error ? e.message : String(e);
  // Per-blob-failure detail goes into the deletionQueue table for retry.
  // The job's canonical line accumulates a backend_failures count + a
  // partial_failure outcome — operators correlate via request_id and dig
  // into deletionQueue rows for blob-level detail.
  const db = createDb(env.DB);
  await db
    .insert(deletionQueue)
    .values({
      id: newId(),
      physicalBlobId,
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
      lastError: message.slice(0, 500),
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}
