// Upload methods — registerUpload, signPart, recordPart, getMultipartStatus,
// finalize, abandon, put. See spec §API Contract — Upload methods and
// RFC §10.
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  DEFAULT_PENDING_TIMER_SECONDS,
  MULTIPART_MAX_OBJECT_BYTES,
  MULTIPART_MAX_PARTS,
  MULTIPART_PART_SIZE_BYTES,
  SINGLE_PART_LIMIT_BYTES,
} from "../config";
import { createDb } from "../db";
import { newId } from "../ids";
import { requireRequestLog } from "@somewhatintelligent/kit/log";
import { readCallerApp, type RoadieInstance } from "../log";
import { validateMeta, type CallMeta } from "../meta";
import { err, ok, type Result } from "../result";
import { blobMultipartPart, blobReference, physicalBlob } from "../schema";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  presignPartPut,
  presignPut,
  type PresignedPut,
} from "../sign";

const HASH_RE = /^[a-f0-9]{64}$/;

function hexToBase64(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

// ---------- registerUpload ----------

export type RegisterUploadInput = {
  hash: string;
  size: number;
  contentType: string;
  application: { app: string; resourceType: string; resourceId: string };
  enforceChecksum?: boolean;
  pendingTimerSeconds?: number; // v1: ignored
  gracePeriodSeconds?: number; // v1: ignored
};

// Content-addressable dedup is global: a (hash, size) tuple identifies the
// bytes irrespective of who's uploading. `size_mismatch` fires when a caller
// registers the same hash as a live physical blob but with a different
// declared size — either a hash collision (cryptographically implausible)
// or a lying client.
export type RegisterUploadError = "size_exceeds_limit" | "invalid_hash" | "size_mismatch";

export type RegisterUploadValue =
  | { status: "ready"; referenceId: string; blobId: string }
  | {
      status: "single-part";
      referenceId: string;
      blobId: string;
      upload: PresignedPut;
    }
  | {
      status: "multipart";
      referenceId: string;
      blobId: string;
      uploadId: string;
      partSize: number;
      partCount: number;
      expiresAt: number;
    };

export async function registerUpload(
  roadie: RoadieInstance,
  input: RegisterUploadInput,
  rawMeta: unknown,
): Promise<Result<RegisterUploadValue, RegisterUploadError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({
    hash: input.hash,
    size: input.size,
    content_type: input.contentType,
    application_app: input.application.app,
    application_resource_type: input.application.resourceType,
    application_resource_id: input.application.resourceId,
  });
  if (!HASH_RE.test(input.hash)) return err("invalid_hash");
  if (input.size < 0 || input.size > MULTIPART_MAX_OBJECT_BYTES) {
    return err("size_exceeds_limit");
  }

  const callerApp = readCallerApp(roadie, meta);
  const db = createDb(roadie.env.DB);

  // Find the live physical_blob (if any) for this hash. Live = not yet
  // deleted; the partial UNIQUE(hash) index guarantees at most one row.
  const [existing] = await db
    .select()
    .from(physicalBlob)
    .where(and(eq(physicalBlob.hash, input.hash), isNull(physicalBlob.deletedAt)))
    .limit(1);

  if (existing) {
    if (existing.size !== input.size) return err("size_mismatch");
    return existing.finalizedAt !== null
      ? attachFinalizedReference(roadie, input, callerApp, existing.id)
      : takeOverPending(roadie, input, callerApp, existing);
  }

  return createFreshBlob(roadie, input, callerApp);
}

// Dedup hit against a finalized physical blob. Add a reference (or return
// the existing one if the caller's (app, resourceType, resourceId) already
// has one on this blob — idempotent retry).
async function attachFinalizedReference(
  roadie: RoadieInstance,
  input: RegisterUploadInput,
  callerApp: string,
  physicalBlobId: string,
): Promise<Result<RegisterUploadValue, RegisterUploadError>> {
  const db = createDb(roadie.env.DB);
  const refId = newId();
  const now = new Date();
  try {
    await db.batch([
      db.insert(blobReference).values({
        id: refId,
        physicalBlobId,
        app: input.application.app,
        resourceType: input.application.resourceType,
        resourceId: input.application.resourceId,
        callerApp,
        contentType: input.contentType,
        createdAt: now,
      }),
      db
        .update(physicalBlob)
        .set({ refcount: sql`${physicalBlob.refcount} + 1` })
        .where(eq(physicalBlob.id, physicalBlobId)),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes("UNIQUE constraint failed")) throw e;
    const existingRef = await lookupReferenceTuple(roadie, physicalBlobId, input.application);
    if (!existingRef) throw e;
    requireRequestLog().add({ blob_id: physicalBlobId, dedup_hit: true, upload_mode: "ready" });
    return ok({ status: "ready", referenceId: existingRef.id, blobId: physicalBlobId });
  }
  requireRequestLog().add({ blob_id: physicalBlobId, dedup_hit: true, upload_mode: "ready" });
  return ok({ status: "ready", referenceId: refId, blobId: physicalBlobId });
}

// Take over a pending physical blob. Two sub-cases:
//
//   1. Caller's (callerApp, app, resourceType, resourceId) already matches the
//      single existing reference on this pending blob. Idempotent retry —
//      re-issue the upload envelope with the existing referenceId.
//
//   2. Caller's tuple is different (either a different consumer, or the same
//      consumer with a different resource). Reassign the pending blob's
//      single reference to the caller by delete-and-insert, issuing a fresh
//      referenceId. The previous reference handle is invalidated; the
//      previous caller's record should treat their record as orphaned.
//
// The "one reference per pending blob" invariant is preserved in both cases:
// we never add a second reference while the physical blob is pending — we
// either reuse (case 1) or reassign (case 2).
async function takeOverPending(
  roadie: RoadieInstance,
  input: RegisterUploadInput,
  callerApp: string,
  pending: typeof physicalBlob.$inferSelect,
): Promise<Result<RegisterUploadValue, RegisterUploadError>> {
  const db = createDb(roadie.env.DB);
  const [priorRef] = await db
    .select()
    .from(blobReference)
    .where(eq(blobReference.physicalBlobId, pending.id))
    .limit(1);

  let referenceId: string;
  let took = false;
  if (
    priorRef &&
    priorRef.callerApp === callerApp &&
    priorRef.app === input.application.app &&
    priorRef.resourceType === input.application.resourceType &&
    priorRef.resourceId === input.application.resourceId
  ) {
    referenceId = priorRef.id;
  } else {
    referenceId = newId();
    const now = new Date();
    // Delete the stale reference (if any) and insert the new one in a single
    // batch. Force refcount = 1 to absorb both the abandoned-originator case
    // (refcount was 0) and the normal take-over case (refcount was 1).
    const insertNew = db.insert(blobReference).values({
      id: referenceId,
      physicalBlobId: pending.id,
      app: input.application.app,
      resourceType: input.application.resourceType,
      resourceId: input.application.resourceId,
      callerApp,
      contentType: input.contentType,
      createdAt: now,
    });
    const resetRefcount = db
      .update(physicalBlob)
      .set({ refcount: 1 })
      .where(eq(physicalBlob.id, pending.id));
    if (priorRef) {
      await db.batch([
        db.delete(blobReference).where(eq(blobReference.id, priorRef.id)),
        insertNew,
        resetRefcount,
      ]);
    } else {
      await db.batch([insertNew, resetRefcount]);
    }
    took = true;
  }

  const envelope = await presignPendingEnvelope(roadie, pending, input.contentType, referenceId);
  requireRequestLog().add({
    blob_id: pending.id,
    dedup_hit: false,
    upload_mode: pending.uploadMode,
    pending_retry: !took,
    taken_over: took,
  });
  return envelope;
}

async function lookupReferenceTuple(
  roadie: RoadieInstance,
  physicalBlobId: string,
  application: RegisterUploadInput["application"],
): Promise<{ id: string } | undefined> {
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({ id: blobReference.id })
    .from(blobReference)
    .where(
      and(
        eq(blobReference.physicalBlobId, physicalBlobId),
        eq(blobReference.app, application.app),
        eq(blobReference.resourceType, application.resourceType),
        eq(blobReference.resourceId, application.resourceId),
      ),
    )
    .limit(1);
  return row;
}

async function presignPendingEnvelope(
  roadie: RoadieInstance,
  pending: typeof physicalBlob.$inferSelect,
  contentType: string,
  referenceId: string,
): Promise<Result<RegisterUploadValue, RegisterUploadError>> {
  if (pending.uploadMode === "single") {
    const presigned = await presignPut(roadie.env, pending.id, {
      contentLength: pending.size,
      contentType,
      ...(pending.enforceChecksum ? { checksumSha256Base64: hexToBase64(pending.hash) } : {}),
      expiresInSeconds: 3600,
    });
    return ok({
      status: "single-part",
      referenceId,
      blobId: pending.id,
      upload: presigned,
    });
  }

  if (
    pending.uploadMode === "multipart" &&
    pending.r2UploadId !== null &&
    pending.partSize !== null &&
    pending.partCount !== null
  ) {
    return ok({
      status: "multipart",
      referenceId,
      blobId: pending.id,
      uploadId: pending.r2UploadId,
      partSize: pending.partSize,
      partCount: pending.partCount,
      expiresAt: pending.createdAt.getTime() + DEFAULT_PENDING_TIMER_SECONDS * 1000,
    });
  }

  // Pending but neither single-part-presignable nor multipart-resumable.
  // Only legitimate cause: a `put()`-created row whose write failed mid-flight
  // without being cleaned up. Surface rather than silently lying.
  return err("internal_error" as never);
}

async function createFreshBlob(
  roadie: RoadieInstance,
  input: RegisterUploadInput,
  callerApp: string,
): Promise<Result<RegisterUploadValue, RegisterUploadError>> {
  const db = createDb(roadie.env.DB);
  const now = new Date();
  const physId = newId();
  const refId = newId();

  if (input.size <= SINGLE_PART_LIMIT_BYTES) {
    await db.batch([
      db.insert(physicalBlob).values({
        id: physId,
        hash: input.hash,
        size: input.size,
        uploadMode: "single",
        partSize: null,
        partCount: null,
        r2UploadId: null,
        enforceChecksum: input.enforceChecksum === true,
        refcount: 1,
        createdAt: now,
        finalizedAt: null,
        deletedAt: null,
      }),
      db.insert(blobReference).values({
        id: refId,
        physicalBlobId: physId,
        app: input.application.app,
        resourceType: input.application.resourceType,
        resourceId: input.application.resourceId,
        callerApp,
        contentType: input.contentType,
        createdAt: now,
      }),
    ]);

    const presigned = await presignPut(roadie.env, physId, {
      contentLength: input.size,
      contentType: input.contentType,
      ...(input.enforceChecksum ? { checksumSha256Base64: hexToBase64(input.hash) } : {}),
      expiresInSeconds: 3600,
    });
    requireRequestLog().add({ blob_id: physId, dedup_hit: false, upload_mode: "single" });
    return ok({ status: "single-part", referenceId: refId, blobId: physId, upload: presigned });
  }

  const partSize = MULTIPART_PART_SIZE_BYTES;
  const partCount = Math.ceil(input.size / partSize);
  if (partCount > MULTIPART_MAX_PARTS) return err("size_exceeds_limit");

  const { uploadId } = await createMultipartUpload(roadie.env, physId, {
    contentType: input.contentType,
  });

  await db.batch([
    db.insert(physicalBlob).values({
      id: physId,
      hash: input.hash,
      size: input.size,
      uploadMode: "multipart",
      partSize,
      partCount,
      r2UploadId: uploadId,
      enforceChecksum: false,
      refcount: 1,
      createdAt: now,
      finalizedAt: null,
      deletedAt: null,
    }),
    db.insert(blobReference).values({
      id: refId,
      physicalBlobId: physId,
      app: input.application.app,
      resourceType: input.application.resourceType,
      resourceId: input.application.resourceId,
      callerApp,
      contentType: input.contentType,
      createdAt: now,
    }),
  ]);
  requireRequestLog().add({ blob_id: physId, dedup_hit: false, upload_mode: "multipart" });
  return ok({
    status: "multipart",
    referenceId: refId,
    blobId: physId,
    uploadId,
    partSize,
    partCount,
    expiresAt: now.getTime() + DEFAULT_PENDING_TIMER_SECONDS * 1000,
  });
}

// ---------- signPart ----------

export type SignPartInput = { referenceId: string; partNumber: number; size: number };

export type SignPartError =
  | "reference_not_found"
  | "not_multipart"
  | "expired"
  | "finalized"
  | "invalid_part_number"
  | "invalid_part_size";

async function resolveMultipartContext(
  roadie: RoadieInstance,
  meta: CallMeta,
  referenceId: string,
): Promise<
  | { found: false }
  | {
      found: true;
      physicalBlobId: string;
      createdAt: Date;
      finalizedAt: Date | null;
      uploadMode: "single" | "multipart" | "server";
      partSize: number | null;
      partCount: number | null;
      r2UploadId: string | null;
    }
> {
  const callerApp = readCallerApp(roadie, meta);
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({
      physicalBlobId: physicalBlob.id,
      createdAt: physicalBlob.createdAt,
      finalizedAt: physicalBlob.finalizedAt,
      uploadMode: physicalBlob.uploadMode,
      partSize: physicalBlob.partSize,
      partCount: physicalBlob.partCount,
      r2UploadId: physicalBlob.r2UploadId,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(and(eq(blobReference.id, referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!row) return { found: false };
  return { found: true, ...row };
}

// Multipart uploads have a bounded lifetime. Roadie itself enforces the cutoff
// at the DEFAULT_PENDING_TIMER_SECONDS boundary (24h); the R2 bucket-level
// lifecycle rule (7d) is a backstop for cases where Roadie's pending reaper
// hasn't yet fired. Without this check, signPart / recordPart would happily
// sign URLs against a multipart that R2 has already aborted, surfacing the
// failure much later at completeMultipartUpload time as backend_unavailable.
function isMultipartExpired(createdAt: Date): boolean {
  return createdAt.getTime() + DEFAULT_PENDING_TIMER_SECONDS * 1000 < Date.now();
}

export async function signPart(
  roadie: RoadieInstance,
  input: SignPartInput,
  rawMeta: unknown,
): Promise<Result<PresignedPut, SignPartError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({ reference_id: input.referenceId, part_number: input.partNumber });
  const ctx = await resolveMultipartContext(roadie, meta, input.referenceId);
  if (!ctx.found) return err("reference_not_found");
  if (ctx.uploadMode !== "multipart") return err("not_multipart");
  if (ctx.finalizedAt !== null) return err("finalized");
  if (!ctx.r2UploadId) return err("expired");
  if (isMultipartExpired(ctx.createdAt)) return err("expired");
  if (!ctx.partCount || !ctx.partSize) return err("not_multipart");
  if (input.partNumber < 1 || input.partNumber > ctx.partCount) {
    return err("invalid_part_number");
  }
  const isFinal = input.partNumber === ctx.partCount;
  if (!isFinal && input.size !== ctx.partSize) return err("invalid_part_size");
  if (isFinal && input.size > ctx.partSize) return err("invalid_part_size");

  log.add({ blob_id: ctx.physicalBlobId });
  const presigned = await presignPartPut(
    roadie.env,
    ctx.physicalBlobId,
    ctx.r2UploadId,
    input.partNumber,
    { contentLength: input.size, expiresInSeconds: 3600 },
  );
  return ok(presigned);
}

// ---------- recordPart ----------

export type RecordPartInput = {
  referenceId: string;
  partNumber: number;
  etag: string;
  size: number;
};

export type RecordPartError = "reference_not_found" | "not_multipart" | "expired";

export async function recordPart(
  roadie: RoadieInstance,
  input: RecordPartInput,
  rawMeta: unknown,
): Promise<Result<null, RecordPartError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({
    reference_id: input.referenceId,
    part_number: input.partNumber,
    size: input.size,
  });
  const ctx = await resolveMultipartContext(roadie, meta, input.referenceId);
  if (!ctx.found) return err("reference_not_found");
  if (ctx.uploadMode !== "multipart") return err("not_multipart");
  if (!ctx.r2UploadId) return err("expired");
  if (isMultipartExpired(ctx.createdAt)) return err("expired");
  log.add({ blob_id: ctx.physicalBlobId });

  const db = createDb(roadie.env.DB);
  await db
    .insert(blobMultipartPart)
    .values({
      id: newId(),
      physicalBlobId: ctx.physicalBlobId,
      partNumber: input.partNumber,
      etag: input.etag,
      size: input.size,
      recordedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [blobMultipartPart.physicalBlobId, blobMultipartPart.partNumber],
      set: { etag: input.etag, size: input.size, recordedAt: new Date() },
    });
  return ok(null);
}

// ---------- getMultipartStatus ----------

export type GetMultipartStatusInput = { referenceId: string };
export type GetMultipartStatusError = "reference_not_found" | "not_multipart" | "expired";
export type GetMultipartStatusValue = {
  partsReceived: number[];
  partCount: number;
  partSize: number;
  expiresAt: number;
};

export async function getMultipartStatus(
  roadie: RoadieInstance,
  input: GetMultipartStatusInput,
  rawMeta: unknown,
): Promise<Result<GetMultipartStatusValue, GetMultipartStatusError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({ reference_id: input.referenceId });
  const ctx = await resolveMultipartContext(roadie, meta, input.referenceId);
  if (!ctx.found) return err("reference_not_found");
  if (ctx.uploadMode !== "multipart") return err("not_multipart");
  if (!ctx.r2UploadId) return err("expired");
  if (isMultipartExpired(ctx.createdAt)) return err("expired");
  if (!ctx.partCount || !ctx.partSize) return err("not_multipart");
  log.add({ blob_id: ctx.physicalBlobId });

  const db = createDb(roadie.env.DB);
  const rows = await db
    .select({ partNumber: blobMultipartPart.partNumber })
    .from(blobMultipartPart)
    .where(eq(blobMultipartPart.physicalBlobId, ctx.physicalBlobId));
  return ok({
    partsReceived: rows.map((r) => r.partNumber).sort((a, b) => a - b),
    partCount: ctx.partCount,
    partSize: ctx.partSize,
    // Upload window is fixed DEFAULT_PENDING_TIMER_SECONDS from creation.
    expiresAt: ctx.createdAt.getTime() + DEFAULT_PENDING_TIMER_SECONDS * 1000,
  });
}

// ---------- finalize ----------

export type FinalizeInput = { referenceId: string };

export type FinalizeError =
  | "reference_not_found"
  | "not_pending"
  | "size_mismatch"
  | "checksum_mismatch"
  | "missing_parts"
  | "backend_unavailable";

export type FinalizeValue = {
  referenceId: string;
  blobId: string;
  size: number;
  hash: string;
};

export async function finalize(
  roadie: RoadieInstance,
  input: FinalizeInput,
  rawMeta: unknown,
): Promise<Result<FinalizeValue, FinalizeError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const callerApp = readCallerApp(roadie, meta);
  log.add({ reference_id: input.referenceId });
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({
      physicalBlobId: physicalBlob.id,
      size: physicalBlob.size,
      uploadMode: physicalBlob.uploadMode,
      finalizedAt: physicalBlob.finalizedAt,
      deletedAt: physicalBlob.deletedAt,
      hash: physicalBlob.hash,
      r2UploadId: physicalBlob.r2UploadId,
      enforceChecksum: physicalBlob.enforceChecksum,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(and(eq(blobReference.id, input.referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!row) return err("reference_not_found");
  log.add({ blob_id: row.physicalBlobId });
  if (row.deletedAt !== null || row.finalizedAt !== null) return err("not_pending");

  if (row.uploadMode === "multipart") {
    const parts = await db
      .select({ partNumber: blobMultipartPart.partNumber, etag: blobMultipartPart.etag })
      .from(blobMultipartPart)
      .where(eq(blobMultipartPart.physicalBlobId, row.physicalBlobId));
    if (!row.r2UploadId) return err("not_pending");
    try {
      await completeMultipartUpload(
        roadie.env,
        row.physicalBlobId,
        row.r2UploadId,
        parts.sort((a, b) => a.partNumber - b.partNumber),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/InvalidPart|NoSuchUpload/i.test(msg)) return err("missing_parts");
      return err("backend_unavailable", msg);
    }
    const finalized = await roadie.env.BLOBS.head(row.physicalBlobId);
    if (!finalized) return err("backend_unavailable");
    if (finalized.size !== row.size) return err("size_mismatch");

    const now = new Date();
    await db
      .update(physicalBlob)
      .set({ finalizedAt: now, r2UploadId: null })
      .where(eq(physicalBlob.id, row.physicalBlobId));
    return ok({
      referenceId: input.referenceId,
      blobId: row.physicalBlobId,
      size: finalized.size,
      hash: row.hash,
    });
  }

  // Single-part.
  let headResult: R2Object | null = null;
  try {
    headResult = await roadie.env.BLOBS.head(row.physicalBlobId);
  } catch (e) {
    return err("backend_unavailable", e instanceof Error ? e.message : String(e));
  }
  if (!headResult) return err("not_pending");
  if (headResult.size !== row.size) return err("size_mismatch");
  if (row.enforceChecksum) {
    const sha = headResult.checksums?.sha256;
    if (!sha) return err("checksum_mismatch");
    const hex = arrayBufferToHex(sha);
    if (hex !== row.hash) return err("checksum_mismatch");
  }
  const now = new Date();
  await db
    .update(physicalBlob)
    .set({ finalizedAt: now })
    .where(eq(physicalBlob.id, row.physicalBlobId));
  return ok({
    referenceId: input.referenceId,
    blobId: row.physicalBlobId,
    size: headResult.size,
    hash: row.hash,
  });
}

function arrayBufferToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}

// ---------- abandon ----------

export type AbandonInput = { referenceId: string };
export type AbandonError = "reference_not_found" | "already_ready";

export async function abandon(
  roadie: RoadieInstance,
  input: AbandonInput,
  rawMeta: unknown,
): Promise<Result<null, AbandonError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const callerApp = readCallerApp(roadie, meta);
  log.add({ reference_id: input.referenceId });
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({
      physicalBlobId: physicalBlob.id,
      r2UploadId: physicalBlob.r2UploadId,
      finalizedAt: physicalBlob.finalizedAt,
      refcount: physicalBlob.refcount,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(and(eq(blobReference.id, input.referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!row) return err("reference_not_found");
  if (row.finalizedAt !== null) return err("already_ready");
  log.add({ blob_id: row.physicalBlobId });

  // Atomic delete-of-ref + decrement-of-refcount. The SQL expression is
  // evaluated by the database as `refcount - 1`, not read-then-set.
  await db.batch([
    db.delete(blobReference).where(eq(blobReference.id, input.referenceId)),
    db
      .update(physicalBlob)
      .set({ refcount: sql`${physicalBlob.refcount} - 1` })
      .where(eq(physicalBlob.id, row.physicalBlobId)),
  ]);

  // Re-select the post-decrement refcount. A concurrent registerUpload
  // take-over may have reset refcount to 1 between the batch and here; if
  // so, the blob is owned again and we must not GC.
  const [after] = await db
    .select({ refcount: physicalBlob.refcount })
    .from(physicalBlob)
    .where(eq(physicalBlob.id, row.physicalBlobId))
    .limit(1);
  if (!after || after.refcount > 0) return ok(null);

  // ARC-at-zero: mark deleted with an explicit `refcount = 0` guard so a
  // concurrent take-over that bumped refcount between the SELECT above
  // and this UPDATE cannot slip through. We then SELECT back — if
  // `deletedAt` is still null, the guard fired and another caller owns
  // the blob; abort GC. If it's set, we won the race.
  const now = new Date();
  await db
    .update(physicalBlob)
    .set({ deletedAt: now })
    .where(and(eq(physicalBlob.id, row.physicalBlobId), eq(physicalBlob.refcount, 0)));
  const [verify] = await db
    .select({ deletedAt: physicalBlob.deletedAt })
    .from(physicalBlob)
    .where(eq(physicalBlob.id, row.physicalBlobId))
    .limit(1);
  if (!verify || verify.deletedAt === null) {
    log.add({ arc_at_zero_aborted: true });
    return ok(null);
  }

  if (row.r2UploadId) {
    roadie.ctx.waitUntil(
      abortMultipartUpload(roadie.env, row.physicalBlobId, row.r2UploadId).catch((e: unknown) => {
        console.error({
          service: "roadie",
          event: "rpc",
          operation: "abortMultipartUpload",
          outcome: "backend_unavailable",
          error_message: e instanceof Error ? e.message : String(e),
          time: new Date().toISOString(),
        });
      }),
    );
  } else {
    roadie.ctx.waitUntil(
      roadie.env.BLOBS.delete(row.physicalBlobId).catch((e: unknown) => {
        console.error({
          service: "roadie",
          event: "rpc",
          operation: "backendDelete",
          outcome: "backend_unavailable",
          error_message: e instanceof Error ? e.message : String(e),
          time: new Date().toISOString(),
        });
      }),
    );
  }
  return ok(null);
}

// ---------- put ----------

export type PutInput = {
  hash: string;
  size: number;
  contentType: string;
  application: { app: string; resourceType: string; resourceId: string };
  body: ReadableStream | ArrayBuffer;
};

export type PutError =
  | "size_exceeds_limit"
  | "invalid_hash"
  | "hash_mismatch"
  | "size_mismatch"
  | "backend_unavailable";

export type PutValue = { referenceId: string; blobId: string; deduped: boolean };

// Server-side put for consumer-held bytes. Bytes stream through the R2
// binding without buffering in the Worker. If a live physical_blob already
// exists for this hash (dedup hit), the bytes are NOT re-written to R2 —
// we just add a reference.
export async function put(
  roadie: RoadieInstance,
  input: PutInput,
  rawMeta: unknown,
): Promise<Result<PutValue, PutError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({
    hash: input.hash,
    size: input.size,
    content_type: input.contentType,
    application_app: input.application.app,
    application_resource_type: input.application.resourceType,
    application_resource_id: input.application.resourceId,
    upload_mode: "server",
  });
  if (!HASH_RE.test(input.hash)) return err("invalid_hash");
  if (input.size < 0 || input.size > SINGLE_PART_LIMIT_BYTES) {
    return err("size_exceeds_limit");
  }

  const callerApp = readCallerApp(roadie, meta);
  const db = createDb(roadie.env.DB);

  // Dedup check — global on hash now that owner model is gone.
  const [existing] = await db
    .select({
      id: physicalBlob.id,
      size: physicalBlob.size,
      finalizedAt: physicalBlob.finalizedAt,
    })
    .from(physicalBlob)
    .where(and(eq(physicalBlob.hash, input.hash), isNull(physicalBlob.deletedAt)))
    .limit(1);

  // Dedup hit on a finalized blob. Reuse the bytes — add a reference only.
  // A pending row is treated as "not a dedup hit" here: put is synchronous,
  // so the cleanest semantics are to write our own bytes (R2 will de-dupe
  // on object key — but our physical_blob id is fresh, so the write just
  // replaces the pending row's stale upload). Simpler to just bail out
  // with backend_unavailable-style recovery: the pending row's take-over
  // path belongs on registerUpload, not put. See §Take-over semantics.
  if (existing && existing.finalizedAt !== null) {
    if (existing.size !== input.size) return err("size_mismatch");
    const refId = newId();
    const now = new Date();
    try {
      await db.batch([
        db.insert(blobReference).values({
          id: refId,
          physicalBlobId: existing.id,
          app: input.application.app,
          resourceType: input.application.resourceType,
          resourceId: input.application.resourceId,
          callerApp,
          contentType: input.contentType,
          createdAt: now,
        }),
        db
          .update(physicalBlob)
          .set({ refcount: sql`${physicalBlob.refcount} + 1` })
          .where(eq(physicalBlob.id, existing.id)),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("UNIQUE constraint failed")) throw e;
      const existingRef = await lookupReferenceTuple(roadie, existing.id, input.application);
      if (!existingRef) throw e;
      log.add({ blob_id: existing.id, dedup_hit: true });
      return ok({ referenceId: existingRef.id, blobId: existing.id, deduped: true });
    }
    log.add({ blob_id: existing.id, dedup_hit: true });
    return ok({ referenceId: refId, blobId: existing.id, deduped: true });
  }

  const now = new Date();
  const physId = newId();
  const refId = newId();

  // Stream bytes into R2 via the binding — SHA256 is passed so R2 rejects
  // bytes that hash to a different value. No buffering in the Worker.
  try {
    await roadie.env.BLOBS.put(physId, input.body, {
      httpMetadata: { contentType: input.contentType },
      sha256: input.hash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/checksum|sha256|hash/i.test(msg)) return err("hash_mismatch", msg);
    return err("backend_unavailable", msg);
  }

  await db.batch([
    db.insert(physicalBlob).values({
      id: physId,
      hash: input.hash,
      size: input.size,
      uploadMode: "server",
      partSize: null,
      partCount: null,
      r2UploadId: null,
      enforceChecksum: true,
      refcount: 1,
      createdAt: now,
      finalizedAt: now,
      deletedAt: null,
    }),
    db.insert(blobReference).values({
      id: refId,
      physicalBlobId: physId,
      app: input.application.app,
      resourceType: input.application.resourceType,
      resourceId: input.application.resourceId,
      callerApp,
      contentType: input.contentType,
      createdAt: now,
    }),
  ]);
  log.add({ blob_id: physId, dedup_hit: false });
  return ok({ referenceId: refId, blobId: physId, deduped: false });
}
