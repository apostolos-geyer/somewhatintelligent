/**
 * Roadie-backed implementation of the package's `GuestlistBlobStore`
 * (@somewhatintelligent/guestlist), injected via `GuestlistConfig.blobs`.
 * This is the whole avatar storage integration: the package owns the RPC
 * routes + ownership checks, this adapter just maps its five capability
 * calls onto roadie's consumer SDK.
 *
 * Actors: `register` carries the authenticated user (roadie tags the
 * reference's owner from `application.resourceId`); the remaining calls use
 * a service actor because the package deliberately gives the adapter no
 * user context — the confirm route enforces the owner match itself (it
 * compares `getReference().ownerUserId` against the session user). roadie
 * still scopes every call to `callerApp: "guestlist"`, so cross-caller
 * references are invisible regardless of actor.
 */
import { createRoadieClient } from "@si/roadie-service/client";
import { getRequestId } from "@somewhatintelligent/kit/request-context";
import type { GuestlistBlobStore } from "@somewhatintelligent/guestlist";
import type { GuestlistEnv } from "./config";

const AVATAR_RESOURCE_TYPE = "user-avatar";

export function makeRoadieBlobStore(env: GuestlistEnv): GuestlistBlobStore {
  // Every call passes an explicit actor override, so the default resolver
  // below should never fire — throw to make a missing override loud rather
  // than silently mis-tag roadie's log lines.
  const roadie = createRoadieClient(env.ROADIE, {
    callerApp: "guestlist",
    getRequestId: () => getRequestId() ?? "unknown",
    getActor: () => {
      throw new Error("guestlist roadie calls must pass an explicit actor override");
    },
  });

  return {
    async register({ hash, size, contentType, ownerUserId }) {
      const result = await roadie.registerUpload(
        {
          hash,
          size,
          contentType,
          application: {
            app: "guestlist",
            resourceType: AVATAR_RESOURCE_TYPE,
            resourceId: ownerUserId,
          },
        },
        { kind: "user", userId: ownerUserId },
      );
      // size_exceeds_limit / invalid_hash / size_mismatch — caller's fault.
      if (!result.ok) return { ok: false, error: result.error };
      const v = result.value;
      if (v.status === "ready") {
        return { ok: true, referenceId: v.referenceId, upload: { status: "ready" } };
      }
      if (v.status === "single-part") {
        return {
          ok: true,
          referenceId: v.referenceId,
          upload: {
            status: "single-part",
            uploadUrl: v.upload.uploadUrl,
            requiredHeaders: v.upload.requiredHeaders,
          },
        };
      }
      // Avatars are capped below roadie's single-part threshold, so a
      // multipart envelope can't happen here; the blob-store plan has no
      // multipart arm, so surface it as an error rather than an unusable plan.
      return { ok: false, error: "unexpected_multipart" };
    },

    async getReference(refId) {
      const ref = await roadie.getReference(
        { referenceId: refId },
        { kind: "service", serviceName: "guestlist-avatar" },
      );
      if (!ref.ok) return null;
      if (ref.value.application.resourceType !== AVATAR_RESOURCE_TYPE) return null;
      // roadie's "ready" is the store's "stored"; "pending"/"deleted" map 1:1.
      const state = ref.value.state === "ready" ? "stored" : ref.value.state;
      return { state, ownerUserId: ref.value.application.resourceId };
    },

    async finalize(refId) {
      const fin = await roadie.finalize(
        { referenceId: refId },
        { kind: "service", serviceName: "guestlist-avatar" },
      );
      if (!fin.ok) return { ok: false, error: fin.error };
      return { ok: true };
    },

    async release(refId) {
      // Fire-and-forget; roadie treats unknown / cross-caller / already-
      // removed references as no-ops, so double release is tolerated.
      await roadie
        .removeReference(
          { referenceId: refId },
          { kind: "service", serviceName: "guestlist-avatar" },
        )
        .catch(() => {});
    },

    async readUrl(refId, { lifetimeSeconds }) {
      const result = await roadie.getReadUrl(
        { referenceId: refId, lifetimeSeconds, permissionScope: "public-avatar" },
        { kind: "service", serviceName: "guestlist-avatar-redirect" },
      );
      if (!result.ok) return null;
      return result.value.url;
    },
  };
}
