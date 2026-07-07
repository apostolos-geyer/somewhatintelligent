// Reference methods: addReference and removeReference.
//
// addReference: create a new reference whose source is an existing reference
// the caller already holds. The new reference's caller_app is the current
// call's callerApp — which may equal or differ from the source's caller_app
// (cross-consumer references are how sharing works — a file-share creates a
// share-side reference whose source is the original owner's drive entry).
//
// removeReference: idempotent — a referenceId that doesn't exist or belongs
// to a different caller is treated as not-existing. When the call brings the
// blob's refcount to zero, bytes are scheduled for backend removal inside
// the same call's lifecycle (spec §Capabilities — Reference management).
// No grace window in v1; no scheduled zero-ref reaper (spec §Deferrals).
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../db";
import { newId } from "../ids";
import { requireRequestLog } from "@greenroom/kit/log";
import { readCallerApp, type RoadieInstance } from "../log";
import { validateMeta } from "../meta";
import { err, ok, type Result } from "../result";
import { blobReference, deletionQueue, physicalBlob } from "../schema";

export type AddReferenceInput = {
  sourceReferenceId: string;
  application: { app: string; resourceType: string; resourceId: string };
  // Caller's own label for the bytes on this reference. Content-type lives
  // per-reference because two consumers can legitimately label identical
  // bytes differently. Optional: if omitted, inherits from the source
  // reference (the common case when the caller is forwarding its own bytes).
  contentType?: string;
};

export type AddReferenceError = "reference_not_found" | "not_ready" | "already_exists";

export type AddReferenceValue = { referenceId: string; blobId: string };

export async function addReference(
  roadie: RoadieInstance,
  input: AddReferenceInput,
  rawMeta: unknown,
): Promise<Result<AddReferenceValue, AddReferenceError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const callerApp = readCallerApp(roadie, meta);
  log.add({
    reference_id: input.sourceReferenceId,
    application_app: input.application.app,
    application_resource_type: input.application.resourceType,
    application_resource_id: input.application.resourceId,
  });

  const db = createDb(roadie.env.DB);
  const [src] = await db
    .select({
      physicalBlobId: blobReference.physicalBlobId,
      contentType: blobReference.contentType,
      finalizedAt: physicalBlob.finalizedAt,
      deletedAt: physicalBlob.deletedAt,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(
      and(eq(blobReference.id, input.sourceReferenceId), eq(blobReference.callerApp, callerApp)),
    )
    .limit(1);
  if (!src) return err("reference_not_found");
  log.add({ blob_id: src.physicalBlobId });
  if (src.deletedAt !== null || src.finalizedAt === null) return err("not_ready");

  const newReferenceId = newId();
  const now = new Date();
  try {
    await db.batch([
      db.insert(blobReference).values({
        id: newReferenceId,
        physicalBlobId: src.physicalBlobId,
        app: input.application.app,
        resourceType: input.application.resourceType,
        resourceId: input.application.resourceId,
        callerApp,
        contentType: input.contentType ?? src.contentType,
        createdAt: now,
      }),
      db
        .update(physicalBlob)
        .set({ refcount: sql`${physicalBlob.refcount} + 1` })
        .where(eq(physicalBlob.id, src.physicalBlobId)),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE constraint failed")) return err("already_exists");
    throw e;
  }
  return ok({ referenceId: newReferenceId, blobId: src.physicalBlobId });
}

export type RemoveReferenceInput = { referenceId: string };

export async function removeReference(
  roadie: RoadieInstance,
  input: RemoveReferenceInput,
  rawMeta: unknown,
): Promise<Result<null, never>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const callerApp = readCallerApp(roadie, meta);
  log.add({ reference_id: input.referenceId });

  const db = createDb(roadie.env.DB);
  // Caller-scoped lookup — cross-caller referenceIds are treated as
  // not-existing for idempotency.
  const [target] = await db
    .select({ physicalBlobId: blobReference.physicalBlobId })
    .from(blobReference)
    .where(and(eq(blobReference.id, input.referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!target) return ok(null);
  log.add({ blob_id: target.physicalBlobId });

  // DELETE + decrement in one batch.
  await db.batch([
    db.delete(blobReference).where(eq(blobReference.id, input.referenceId)),
    db
      .update(physicalBlob)
      .set({ refcount: sql`${physicalBlob.refcount} - 1` })
      .where(eq(physicalBlob.id, target.physicalBlobId)),
  ]);

  const [after] = await db
    .select({ refcount: physicalBlob.refcount })
    .from(physicalBlob)
    .where(eq(physicalBlob.id, target.physicalBlobId))
    .limit(1);
  if (!after || after.refcount > 0) return ok(null);

  // ARC-at-zero: mark deleted with a `refcount = 0` guard so a concurrent
  // addReference that bumped refcount between the SELECT above and this
  // UPDATE can't slip through. We SELECT back to verify the guarded
  // update fired — if deletedAt is still null, another caller owns the
  // blob and we must not schedule the R2 delete.
  const now = new Date();
  await db
    .update(physicalBlob)
    .set({ deletedAt: now })
    .where(and(eq(physicalBlob.id, target.physicalBlobId), eq(physicalBlob.refcount, 0)));
  const [verify] = await db
    .select({ deletedAt: physicalBlob.deletedAt })
    .from(physicalBlob)
    .where(eq(physicalBlob.id, target.physicalBlobId))
    .limit(1);
  if (!verify || verify.deletedAt === null) {
    log.add({ arc_at_zero_aborted: true });
    return ok(null);
  }

  log.add({ arc_at_zero: true });
  roadie.ctx.waitUntil(deleteBackendOrRecord(roadie, target.physicalBlobId));
  return ok(null);
}

// The R2 object key equals the physical blob id (backend keys are opaque
// ulids assigned at creation). We dropped the separate
// `backend_key` column when collapsing the blob model; the invariant
// `r2_key === physical_blob.id` is preserved in every write path.
export async function deleteBackendOrRecord(
  roadie: RoadieInstance,
  physicalBlobId: string,
): Promise<void> {
  try {
    await roadie.env.BLOBS.delete(physicalBlobId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Best-effort insert into failures table; surfaced via canonical log line
    // at error level (spec §Observability). No automatic retry in v1.
    console.error({
      service: "roadie",
      event: "rpc",
      operation: "backendDelete",
      outcome: "backend_unavailable",
      physical_blob_id: physicalBlobId,
      error_message: message,
      time: new Date().toISOString(),
    });
    const db = createDb(roadie.env.DB);
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
}
