// Read methods: getReadUrl and getReference.
// Both are caller-scoped: a referenceId belonging to a different consumer is
// rejected as `reference_not_found` without disclosing whether any other
// consumer holds a reference to the same bytes (spec §API Contract —
// Reference verification).
import { and, eq } from "drizzle-orm";
import {
  DEFAULT_READ_URL_LIFETIME_SECONDS,
  MAX_READ_URL_LIFETIME_SECONDS,
  MIN_READ_URL_LIFETIME_SECONDS,
  READ_URL_CACHE_SAFETY_MARGIN_SECONDS,
} from "../config";
import { createDb } from "../db";
import { newId } from "../ids";
import { requireRequestLog } from "@greenroom/kit/log";
import { readCallerApp, type RoadieInstance } from "../log";
import { validateMeta } from "../meta";
import { err, ok, type Result } from "../result";
import { blobReference, physicalBlob, signedUrlCache } from "../schema";
import { presignGet } from "../sign";

export type GetReadUrlInput = {
  referenceId: string;
  lifetimeSeconds?: number;
  disposition?: "inline" | "attachment";
  filename?: string;
  permissionScope: string;
};

export type GetReadUrlError = "reference_not_found" | "not_ready" | "deleted" | "invalid_lifetime";

export type GetReadUrlValue = { url: string; expiresAt: number; cached: boolean };

export async function getReadUrl(
  roadie: RoadieInstance,
  input: GetReadUrlInput,
  rawMeta: unknown,
): Promise<Result<GetReadUrlValue, GetReadUrlError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const lifetimeSeconds = input.lifetimeSeconds ?? DEFAULT_READ_URL_LIFETIME_SECONDS;
  if (
    lifetimeSeconds < MIN_READ_URL_LIFETIME_SECONDS ||
    lifetimeSeconds > MAX_READ_URL_LIFETIME_SECONDS
  ) {
    return err("invalid_lifetime");
  }
  const disposition = input.disposition ?? "inline";
  const callerApp = readCallerApp(roadie, meta);
  log.add({
    reference_id: input.referenceId,
    lifetime_seconds: lifetimeSeconds,
    disposition,
  });

  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({
      physicalBlobId: physicalBlob.id,
      finalizedAt: physicalBlob.finalizedAt,
      deletedAt: physicalBlob.deletedAt,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(and(eq(blobReference.id, input.referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!row) return err("reference_not_found");

  log.add({ blob_id: row.physicalBlobId });
  if (row.deletedAt !== null) return err("deleted");
  if (row.finalizedAt === null) return err("not_ready");

  const cacheKey = await hashCacheKey(
    row.physicalBlobId,
    lifetimeSeconds,
    disposition,
    input.filename ?? "",
    input.permissionScope,
  );
  const now = Date.now();
  const safeCutoff = now + READ_URL_CACHE_SAFETY_MARGIN_SECONDS * 1000;

  const [cached] = await db
    .select({ url: signedUrlCache.url, expiresAt: signedUrlCache.expiresAt })
    .from(signedUrlCache)
    .where(eq(signedUrlCache.cacheKey, cacheKey))
    .limit(1);
  if (cached && cached.expiresAt.getTime() > safeCutoff) {
    log.add({ cached: true });
    return ok({
      url: cached.url,
      expiresAt: cached.expiresAt.getTime(),
      cached: true,
    });
  }

  const presigned = await presignGet(roadie.env, row.physicalBlobId, {
    lifetimeSeconds,
    disposition,
    ...(input.filename !== undefined ? { filename: input.filename } : {}),
  });
  log.add({ cached: false });

  // Advisory write — defer past the response (ADR-RD-009).
  roadie.ctx.waitUntil(
    (async () => {
      await db
        .insert(signedUrlCache)
        .values({
          id: newId(),
          cacheKey,
          url: presigned.url,
          expiresAt: new Date(presigned.expiresAt),
          createdAt: new Date(now),
        })
        .onConflictDoNothing();
    })(),
  );

  return ok({ url: presigned.url, expiresAt: presigned.expiresAt, cached: false });
}

export type GetReferenceInput = { referenceId: string };

export type GetReferenceError = "reference_not_found";

export type GetReferenceValue = {
  referenceId: string;
  blobId: string;
  hash: string;
  size: number;
  contentType: string;
  state: "pending" | "ready" | "deleted";
  createdAt: number;
  finalizedAt: number | null;
  application: { app: string; resourceType: string; resourceId: string };
};

export async function getReference(
  roadie: RoadieInstance,
  input: GetReferenceInput,
  rawMeta: unknown,
): Promise<Result<GetReferenceValue, GetReferenceError>> {
  const meta = validateMeta(rawMeta);
  const log = requireRequestLog();
  const callerApp = readCallerApp(roadie, meta);
  log.add({ reference_id: input.referenceId });
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({
      ref: blobReference,
      pb: physicalBlob,
    })
    .from(blobReference)
    .innerJoin(physicalBlob, eq(physicalBlob.id, blobReference.physicalBlobId))
    .where(and(eq(blobReference.id, input.referenceId), eq(blobReference.callerApp, callerApp)))
    .limit(1);
  if (!row) return err("reference_not_found");
  const state: GetReferenceValue["state"] =
    row.pb.deletedAt !== null ? "deleted" : row.pb.finalizedAt !== null ? "ready" : "pending";
  log.add({ blob_id: row.pb.id });
  return ok({
    referenceId: row.ref.id,
    blobId: row.pb.id,
    hash: row.pb.hash,
    size: row.pb.size,
    contentType: row.ref.contentType,
    state,
    createdAt: row.pb.createdAt.getTime(),
    finalizedAt: row.pb.finalizedAt ? row.pb.finalizedAt.getTime() : null,
    application: {
      app: row.ref.app,
      resourceType: row.ref.resourceType,
      resourceId: row.ref.resourceId,
    },
  });
}

async function hashCacheKey(
  physicalBlobId: string,
  lifetimeSeconds: number,
  disposition: string,
  filename: string,
  permissionScope: string,
): Promise<string> {
  const material = `${physicalBlobId}|${lifetimeSeconds}|${disposition}|${filename}|${permissionScope}`;
  const buf = new TextEncoder().encode(material);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}
