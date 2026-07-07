// Roadie data model. `physical_blob` is the sole blob record; `blob_reference`
// attaches consumer handles directly to it. `hash` is globally UNIQUE, making
// cross-consumer dedup automatic. Consumer apps enforce their own quotas.
//
// State is derived from the timestamp triple on `physical_blob`: pending while
// `finalized_at IS NULL`, ready while `deleted_at IS NULL`, deleted thereafter.
// Timestamps are unix milliseconds.
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique, uniqueIndex } from "drizzle-orm/sqlite-core";

// The physical object on R2. There is exactly one row per set of bytes in the
// bucket. `id` doubles as the R2 object key (backend keys are opaque ulids
// assigned at creation). Upload-shape fields (`upload_mode`, `part_size`, `part_count`,
// `r2_upload_id`) are inherent properties of the write that produced the row
// and live here rather than on the reference layer. `refcount` is the
// materialized count of live `blob_reference` rows, maintained transactionally.
//
// Invariant: while `finalized_at IS NULL`, `refcount <= 1`. Pending rows admit
// at most one reference — the one created alongside the row. Subsequent
// callers registering the same hash while the row is pending **take over**
// that single reference rather than adding a second one (see `upload.ts`
// `registerUpload`). The invariant survives the take-over because the single
// reference is reassigned, not duplicated.
export const physicalBlob = sqliteTable(
  "physical_blob",
  {
    id: text("id").primaryKey(),
    hash: text("hash").notNull(),
    size: integer("size").notNull(),
    uploadMode: text("upload_mode", { enum: ["single", "multipart", "server"] }).notNull(),
    partSize: integer("part_size"),
    partCount: integer("part_count"),
    r2UploadId: text("r2_upload_id"),
    enforceChecksum: integer("enforce_checksum", { mode: "boolean" }).notNull().default(false),
    refcount: integer("refcount").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    finalizedAt: integer("finalized_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    // Partial unique — a hash is uniquely claimed only while the row is live.
    // A deleted row no longer blocks a fresh upload of the same bytes.
    uniqueIndex("u_pb_hash_alive")
      .on(t.hash)
      .where(sql`${t.deletedAt} IS NULL`),
    index("idx_pb_pending_expiry").on(t.createdAt),
  ],
);

// Consumer-facing reference. `id` IS the `referenceId` returned to the caller;
// it is the stable handle the consumer retains on its resource row.
//
// `caller_app` is captured from `ctx.props.callerApp` at insertion so reference
// resolution can be scoped by calling consumer — a referenceId belonging to a
// different consumer is treated as not-found, never disclosed. `content_type`
// lives here (rather than on `physical_blob`) because two consumers can
// legitimately label identical bytes differently.
export const blobReference = sqliteTable(
  "blob_reference",
  {
    id: text("id").primaryKey(),
    physicalBlobId: text("physical_blob_id")
      .notNull()
      .references(() => physicalBlob.id, { onDelete: "cascade" }),
    app: text("app").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    callerApp: text("caller_app").notNull(),
    contentType: text("content_type").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    unique("u_ref").on(t.physicalBlobId, t.app, t.resourceType, t.resourceId),
    index("idx_ref_physical_blob").on(t.physicalBlobId),
    index("idx_ref_caller").on(t.callerApp),
  ],
);

// Per-part records for multipart uploads. ETag is R2's per-part integrity
// token, forwarded by the client and used at completion time.
export const blobMultipartPart = sqliteTable(
  "blob_multipart_part",
  {
    id: text("id").primaryKey(),
    physicalBlobId: text("physical_blob_id")
      .notNull()
      .references(() => physicalBlob.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    etag: text("etag").notNull(),
    size: integer("size").notNull(),
    recordedAt: integer("recorded_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [unique("u_part").on(t.physicalBlobId, t.partNumber)],
);

// Backend deletion failures. Records failures for operator visibility; no
// retry drainer (see spec §Deferrals — backend-deletion-failure retry).
export const deletionQueue = sqliteTable(
  "deletion_queue",
  {
    id: text("id").primaryKey(),
    physicalBlobId: text("physical_blob_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_dq_next").on(t.nextAttemptAt)],
);

// Signed URL cache. cache_key is SHA256 hex of
// (physicalBlobId + lifetimeSeconds + disposition + filename + permissionScope) —
// the hash keeps the column short and prevents weird characters in scope from
// breaking indexing. Keyed by physicalBlobId so two references to the same
// bytes share cache entries; scope participates in the key so URLs never leak
// across permission contexts.
export const signedUrlCache = sqliteTable(
  "signed_url_cache",
  {
    id: text("id").primaryKey(),
    cacheKey: text("cache_key").notNull().unique(),
    url: text("url").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_suc_expiry").on(t.expiresAt)],
);

// Singleton row (id = "default"). Pre-positioned for the reference-consistency
// reconciler; the reconciler itself is not yet implemented (see spec §Deferrals).
export const reconcileCursor = sqliteTable("reconcile_cursor", {
  id: text("id").primaryKey(),
  cursor: text("cursor"),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  totalProcessed: integer("total_processed").notNull().default(0),
});
