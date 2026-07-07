/**
 * Client-side multipart upload state machine. BROWSER-ONLY — uses
 * XMLHttpRequest for progress events (the fetch API has no equivalent of
 * `xhr.upload.onprogress` in any shipping browser, so without XHR a
 * progress bar would jump 0→100% on every single-part upload).
 *
 * Implements the put-loop part of Roadie's multipart upload flow: given an
 * envelope from `registerUpload` and callbacks for sign/record, streams
 * bytes to R2 in slices, surfaces progress, and resolves when the blob is
 * in storage. The CALLER handles `registerUpload` and `finalize` — those
 * carry app-specific input shapes (referenceId vs fileId, extra domain
 * fields, etc.) that aren't roadie's business.
 *
 * Co-located with the roadie service — every consumer
 * (any consuming app's upload hook) imports
 * the same put-loop instead of re-implementing it.
 *
 * Usage shape:
 *
 *   const reg = await registerUploadServerFn({ data: ... });
 *   if (!reg.ok) throw new Error(reg.error);
 *   await runUpload({
 *     file,
 *     upload: reg.upload,
 *     driver: {
 *       signPart: async ({ partNumber, size }) => {
 *         const r = await signPartServerFn({ data: { fileId, partNumber, size } });
 *         if (!r.ok) throw new Error(r.error);
 *         return { uploadUrl: r.uploadUrl, requiredHeaders: r.requiredHeaders };
 *       },
 *       recordPart: async ({ partNumber, etag, size }) => {
 *         const r = await recordPartServerFn({ data: { fileId, partNumber, etag, size } });
 *         if (!r.ok) throw new Error(r.error);
 *       },
 *     },
 *     onProgress: (bytes, total) => setProgress(bytes / total),
 *   });
 *   if (reg.upload.status !== "ready") {
 *     await finalizeServerFn({ data: { fileId } });
 *   }
 */

/**
 * The upload envelope that `registerUpload` returns. Apps may add their
 * own fields (referenceId, fileId, etc.) — those are carried by closure
 * into the driver callbacks; the put-loop only reads what's typed here.
 */
export type UploadStrategy =
  | { status: "ready" }
  | {
      status: "single-part";
      uploadUrl: string;
      requiredHeaders: Record<string, string>;
    }
  | { status: "multipart"; partSize: number; partCount: number };

export interface UploadDriver {
  /** Sign one multipart part. Throws on failure. */
  signPart(args: {
    partNumber: number;
    size: number;
  }): Promise<{ uploadUrl: string; requiredHeaders: Record<string, string> }>;
  /** Record one finished multipart part's ETag. Throws on failure. */
  recordPart(args: { partNumber: number; etag: string; size: number }): Promise<void>;
}

export type UploadProgress = (uploaded: number, total: number) => void;

export interface RunUploadOpts {
  file: File | Blob;
  /** The `upload` envelope returned by registerUpload — drives the branch. */
  upload: UploadStrategy;
  /** App-specific callbacks. Only invoked in the multipart branch. */
  driver: UploadDriver;
  onProgress?: UploadProgress;
  signal?: AbortSignal;
}

/**
 * Drives the upload state machine. Returns when bytes are in R2 (single-
 * or multipart) or immediately when `upload.status === "ready"` (dedup
 * hit on content hash). The caller is responsible for calling `finalize`
 * after this resolves (or skipping it on the dedup-hit branch, depending
 * on the app's finalize semantics).
 *
 * Throws `UploadError` on any sub-step failure — caller catches and
 * surfaces to UI / state.
 */
export async function runUpload(opts: RunUploadOpts): Promise<void> {
  if (opts.upload.status === "ready") return;

  const total = opts.file.size;

  if (opts.upload.status === "single-part") {
    const result = await putWithProgress({
      url: opts.upload.uploadUrl,
      headers: opts.upload.requiredHeaders,
      body: opts.file,
      onProgress: opts.onProgress ? (loaded) => opts.onProgress!(loaded, total) : undefined,
      signal: opts.signal,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new UploadError(
        "single_part_put_failed",
        `${result.status}${result.body ? `:${result.body.slice(0, 200)}` : ""}`,
      );
    }
    opts.onProgress?.(total, total);
    return;
  }

  // multipart
  const { partSize, partCount } = opts.upload;
  let uploaded = 0;

  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const start = (partNumber - 1) * partSize;
    const end = Math.min(start + partSize, total);
    const slice = opts.file.slice(start, end);
    const partBytes = end - start;

    const signed = await opts.driver.signPart({ partNumber, size: partBytes });

    const baseUploaded = uploaded;
    const result = await putWithProgress({
      url: signed.uploadUrl,
      headers: signed.requiredHeaders,
      body: slice,
      onProgress: opts.onProgress
        ? (loaded) => opts.onProgress!(baseUploaded + loaded, total)
        : undefined,
      signal: opts.signal,
    });
    if (result.status < 200 || result.status >= 300) {
      throw new UploadError(
        "part_put_failed",
        `part ${partNumber}: ${result.status}${result.body ? `:${result.body.slice(0, 200)}` : ""}`,
      );
    }
    if (!result.etag) {
      throw new UploadError("part_put_missing_etag", `part ${partNumber}`);
    }

    await opts.driver.recordPart({ partNumber, etag: result.etag, size: partBytes });

    uploaded += partBytes;
    opts.onProgress?.(uploaded, total);
  }
}

export class UploadError extends Error {
  override name = "UploadError" as const;
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// PUT via XHR so progress events surface (fetch has no upload-progress in
// any shipping browser). Always resolves with status + etag + body —
// caller decides how to react to non-2xx; abort/network errors reject.
function putWithProgress(opts: {
  url: string;
  headers: Record<string, string>;
  body: Blob | File;
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
}): Promise<{ status: number; etag: string; body: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", opts.url);
    // Browsers silently ignore (or throw on) forbidden headers like
    // Content-Length — wrap to keep the loop going past the strict ones.
    for (const [k, v] of Object.entries(opts.headers)) {
      try {
        xhr.setRequestHeader(k, v);
      } catch {
        // forbidden header (Content-Length is auto-set from the body, etc.)
      }
    }
    if (opts.onProgress) {
      xhr.upload.addEventListener("progress", (ev) => {
        if (ev.lengthComputable) opts.onProgress!(ev.loaded);
      });
    }
    xhr.addEventListener("load", () => {
      const etag = stripEtagQuotes(
        xhr.getResponseHeader("ETag") ?? xhr.getResponseHeader("etag") ?? "",
      );
      resolve({ status: xhr.status, etag, body: xhr.responseText ?? "" });
    });
    xhr.addEventListener("error", () =>
      reject(new UploadError("put_network_error", "network failed")),
    );
    xhr.addEventListener("abort", () =>
      reject(new UploadError("put_aborted", "aborted by caller")),
    );
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(opts.body);
  });
}

// R2 wraps ETag values in double quotes; strip them so the value matches
// what `recordPart` expects (raw hex hash).
function stripEtagQuotes(raw: string): string {
  return raw.replace(/^"|"$/g, "");
}
