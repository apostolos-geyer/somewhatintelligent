/**
 * Roadie adapter for Publisher's private MediaStorage port (RFC-0001 D10).
 * ALL Roadie translation for Publisher is confined to this module; swapping
 * in a direct-R2 implementation changes no caller. Wire it over the client
 * factory in `./roadie`:
 *
 *   const media = createRoadieMediaStorage(getRoadie(env), {
 *     application: PUBLISHER_MEDIA_APPLICATION,
 *   });
 *
 * Key reconciliation (exec-plan 0004 open decision 4, RESOLVED): the Roadie
 * referenceId IS the private storage_key. put() does not use `input.key` as
 * the storage locator — Roadie mints the referenceId — it threads
 * `input.key` into Roadie's `application.resourceId` so the reference stays
 * attributable to the domain media record, and returns the minted
 * referenceId as `{key}`. There is no separate key→referenceId map. The
 * returned key must never appear in a DTO, public URL, or RPC contract type
 * (INV-MEDIA-1 / D10).
 *
 * Write path: server-side `roadie.put` stream-through — single-shot, bytes
 * stream through the R2 binding without Worker buffering. NO multipart:
 * the ceiling is Roadie's 100 MB single-part limit, not the browser-direct
 * presign path's 10 GB (accepted limitation, exec-plan 0004 open decision
 * 4). Domain media validation above the port enforces the ceiling before
 * put() is called.
 *
 * Read path: getReadUrl → 302 Response. RFC D10 lets the backend choose an
 * ordinary representation or a redirect; the signed URL never appears in the
 * port's type surface. Delete path: removeReference — idempotent, and
 * refcount/GC is Roadie's job.
 */
import type { RoadieClient } from "@si/roadie-service/client";

import type { MediaStorage, StorageResult } from "./media-storage";

/** The slice of Roadie's consumer SDK the adapter uses. Structural, so tests stub it without a binding. */
export type RoadieMediaClient = Pick<RoadieClient, "put" | "getReadUrl" | "removeReference">;

export interface RoadieMediaStorageOptions {
  /** Roadie application tuple; put() threads the caller's logical key in as resourceId. */
  application: { app: string; resourceType: string };
  /** Signed-read lifetime in seconds. Defaults to 3600 (Roadie's own default). */
  readLifetimeSeconds?: number;
  /** Roadie permission-scope label for signed reads. Defaults to "public". */
  permissionScope?: string;
}

/** Canonical Roadie application tuple for Publisher media (text/page/software imagery). */
export const PUBLISHER_MEDIA_APPLICATION = {
  app: "publisher",
  resourceType: "media",
} as const;

const UNAVAILABLE: StorageResult<never> = { ok: false, error: "unavailable" };
const NOT_FOUND: StorageResult<never> = { ok: false, error: "not_found" };

export function createRoadieMediaStorage(
  client: RoadieMediaClient,
  options: RoadieMediaStorageOptions,
): MediaStorage {
  const lifetimeSeconds = options.readLifetimeSeconds ?? 3600;
  const permissionScope = options.permissionScope ?? "public";
  return {
    async put(input) {
      try {
        const result = await client.put({
          hash: input.sha256,
          size: input.size,
          contentType: input.contentType,
          application: {
            app: options.application.app,
            resourceType: options.application.resourceType,
            resourceId: input.key,
          },
          body: input.body,
        });
        if (!result.ok) return UNAVAILABLE;
        return { ok: true, value: { key: result.value.referenceId } };
      } catch {
        return UNAVAILABLE;
      }
    },
    async read(input) {
      try {
        const result = await client.getReadUrl({
          referenceId: input.key,
          lifetimeSeconds,
          disposition: "inline",
          permissionScope,
        });
        if (!result.ok) {
          // reference_not_found / not_ready / deleted are absence at this
          // layer; invalid_lifetime is an adapter misconfiguration.
          return result.error === "invalid_lifetime" ? UNAVAILABLE : NOT_FOUND;
        }
        return {
          ok: true,
          value: new Response(null, {
            status: 302,
            headers: {
              Location: result.value.url,
              // The signed URL outlives this brief redirect cache.
              "Cache-Control": "private, max-age=300",
            },
          }),
        };
      } catch {
        return UNAVAILABLE;
      }
    },
    async delete(input) {
      try {
        const result = await client.removeReference({ referenceId: input.key });
        if (!result.ok) return UNAVAILABLE;
        return { ok: true, value: undefined };
      } catch {
        return UNAVAILABLE;
      }
    },
  };
}

// Static guard (INV-MEDIA-1 / D10): the port's public surface — method
// names, input keys, result-payload keys — must not name a Roadie lifecycle
// concept. A violation fails `bun run typecheck`.
type PayloadKeys<R> = R extends { ok: true; value: infer V }
  ? V extends object
    ? keyof V
    : never
  : never;
type PortSurface =
  | keyof MediaStorage
  | keyof Parameters<MediaStorage["put"]>[0]
  | keyof Parameters<MediaStorage["read"]>[0]
  | PayloadKeys<Awaited<ReturnType<MediaStorage["read"]>>>
  | PayloadKeys<Awaited<ReturnType<MediaStorage["delete"]>>>;
type RoadieVocabulary =
  | "referenceId"
  | "blobId"
  | "uploadId"
  | "uploadUrl"
  | "signedUrl"
  | "register"
  | "finalize"
  | "multipart"
  | "signPart"
  | "recordPart"
  | "presign";
type AssertNever<T extends never> = T;
type _PortHasNoRoadieVocabulary = AssertNever<Extract<PortSurface, RoadieVocabulary>>;
