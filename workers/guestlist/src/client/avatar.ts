// Browser-callable avatar methods. Spread onto the guestlist client by
// `./react.ts` so callers reach them as `guestlist.setAvatar(blob, opts)`
// / `guestlist.removeAvatar()`. RPC is typed eden treaty against
// `GuestlistApp`; the R2 PUT in step 2 uses `runUpload` from roadie's
// client SDK.
import { treaty } from "@elysiajs/eden";
import { runUpload, type UploadDriver } from "@greenroom/roadie-service/client/upload";
import type { GuestlistApp } from "../index";

export type AvatarContentType = "image/jpeg" | "image/png" | "image/webp";

export class AvatarError extends Error {
  override name = "AvatarError" as const;
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export interface SetAvatarOpts {
  contentType: AvatarContentType;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

export interface AvatarMethods {
  /**
   * Three-step presigned upload of a new avatar:
   *   1. `register` — guestlist asks roadie for a presigned envelope
   *   2. `runUpload` — browser PUTs the bytes directly to R2
   *   3. `confirm` — guestlist finalizes the blob, writes the URL onto
   *      `user.image` via Better Auth, and dereferences the prior avatar
   *
   * Returns the new image URL on success. Throws `AvatarError` if any
   * sub-step fails; guestlist's confirm route handles its own rollback so
   * a failure doesn't leak orphan blobs.
   */
  setAvatar(blob: Blob, opts: SetAvatarOpts): Promise<{ image: string }>;
  /** Clears the user's avatar (sets `user.image = null`) and dereferences. */
  removeAvatar(): Promise<void>;
}

type GuestlistTreaty = ReturnType<typeof treaty<GuestlistApp>>;

/**
 * Builds the avatar methods bound to a treaty client. The factory keeps
 * the methods' implementation co-located so the call surface
 * (`guestlist.setAvatar` / `guestlist.removeAvatar`) is wired in one place.
 */
export function createAvatarMethods(api: GuestlistTreaty): AvatarMethods {
  return {
    setAvatar: async (blob, opts) => {
      const hash = await sha256Hex(blob);
      const size = blob.size;

      const reg = await api.api.avatar.register.post({
        hash,
        size,
        contentType: opts.contentType,
      });
      if (reg.error) {
        throw asAvatarError(reg.error, "register_failed");
      }
      const { referenceId, upload } = reg.data;

      try {
        await runUpload({
          file: blob,
          upload,
          driver: unreachableMultipartDriver,
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
          ...(opts.signal ? { signal: opts.signal } : {}),
        });
      } catch (e) {
        // Best-effort rollback so a failed PUT doesn't leak the pending ref.
        // (Roadie's pending reaper will eventually GC it either way.)
        await api.api.avatar.delete().catch(() => {});
        throw e;
      }

      const conf = await api.api.avatar.confirm.post({ referenceId });
      if (conf.error) {
        throw asAvatarError(conf.error, "confirm_failed");
      }
      return { image: conf.data.image };
    },

    removeAvatar: async () => {
      const res = await api.api.avatar.delete();
      if (res.error) {
        throw asAvatarError(res.error, "remove_failed");
      }
    },
  };
}

// ---------- internals ----------

// Eden treaty's error type carries `{ status, value }`. The value is the
// route's typed error response body (`{ error, message? }` for our routes)
// — we surface both so callers can distinguish failure modes.
type TreatyError = { status: number; value: unknown };

function asAvatarError(error: TreatyError, fallbackCode: string): AvatarError {
  const value = error.value as { error?: string; message?: string } | string | null;
  if (typeof value === "string") {
    return new AvatarError(fallbackCode, value, error.status);
  }
  return new AvatarError(value?.error ?? fallbackCode, value?.message ?? "", error.status);
}

// SHA-256 of a Blob as lowercase hex. Matches the format roadie's
// `registerUpload` expects (it converts to base64 internally for the
// x-amz-checksum-sha256 header on the presigned PUT).
async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i] as number;
    hex += (b < 16 ? "0" : "") + b.toString(16);
  }
  return hex;
}

// Avatars are always single-part (≤ 8MB ≤ SINGLE_PART_LIMIT_BYTES), so
// `runUpload`'s multipart branch is unreachable. The driver throws if
// invoked so a future change that lifts the size cap above the multipart
// threshold trips loudly here instead of silently failing.
const unreachableMultipartDriver: UploadDriver = {
  signPart: () => {
    throw new Error("avatar uploads must be single-part");
  },
  recordPart: () => {
    throw new Error("avatar uploads must be single-part");
  },
};
