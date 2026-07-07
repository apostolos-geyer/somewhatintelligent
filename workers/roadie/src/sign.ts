// SigV4 presigning against R2's S3-compat endpoint. The R2 binding does not
// offer presigning — this is the only path for client-direct uploads and
// reads. See RFC ADR-RD-002, ADR-RD-004.
//
// `AwsClient` is cached at module scope so aws4fetch's internal signing-key
// derivation is amortized across calls (ADR-RD-005). The cache is keyed by
// access key id so credential rotation is picked up on redeploy.
import { AwsClient } from "aws4fetch";
import { R2_REGION } from "./config";
import type { RoadieEnv } from "./roadie-env";

let cached: { accessKeyId: string; client: AwsClient } | null = null;

function client(env: RoadieEnv): AwsClient {
  if (cached && cached.accessKeyId === env.S3_ACCESS_KEY_ID) return cached.client;
  const c = new AwsClient({
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    service: "s3",
    region: R2_REGION,
  });
  cached = { accessKeyId: env.S3_ACCESS_KEY_ID, client: c };
  return c;
}

function objectUrl(env: RoadieEnv, key: string): string {
  // Backend keys are opaque identifiers chosen by Roadie (ids.ts output);
  // they will never contain path separators or reserved characters, so a
  // single encodeURIComponent is sufficient and matches R2's S3-API path
  // handling (singleEncode: true by default).
  return `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}/${encodeURIComponent(key)}`;
}

export type PresignedPut = {
  uploadUrl: string;
  requiredHeaders: Record<string, string>;
  expiresAt: number;
};

async function signQueryUrl(
  env: RoadieEnv,
  method: "GET" | "PUT",
  url: string,
  headers: Record<string, string>,
): Promise<string> {
  const signed = await client(env).sign(url, {
    method,
    headers,
    aws: { signQuery: true, allHeaders: true },
  });
  return signed.url.toString();
}

// Presign a single-part PUT. Binds Content-Length and Content-Type into the
// signature; the backend rejects PUTs whose presented headers diverge. When
// checksumSha256 is supplied, x-amz-checksum-sha256 is also bound and the
// backend rejects bytes that hash to a different value.
//
// Note: SHA256 here is the base64-encoded digest per the S3 checksum spec
// (not hex). Roadie receives a hex hash from the consumer and converts it.
export async function presignPut(
  env: RoadieEnv,
  key: string,
  opts: {
    contentLength: number;
    contentType: string;
    checksumSha256Base64?: string;
    expiresInSeconds: number;
  },
): Promise<PresignedPut> {
  const base = objectUrl(env, key);
  const url = `${base}?X-Amz-Expires=${opts.expiresInSeconds}`;
  const headers: Record<string, string> = {
    "content-length": String(opts.contentLength),
    "content-type": opts.contentType,
  };
  if (opts.checksumSha256Base64) {
    headers["x-amz-checksum-sha256"] = opts.checksumSha256Base64;
  }
  const uploadUrl = await signQueryUrl(env, "PUT", url, headers);
  return {
    uploadUrl,
    requiredHeaders: headers,
    expiresAt: Date.now() + opts.expiresInSeconds * 1000,
  };
}

// Presign a per-part PUT for multipart. Upload id must come from the S3 API
// (not the native binding) — the two have separate upload-id namespaces.
export async function presignPartPut(
  env: RoadieEnv,
  key: string,
  uploadId: string,
  partNumber: number,
  opts: { contentLength: number; expiresInSeconds: number },
): Promise<PresignedPut> {
  const base = objectUrl(env, key);
  const url =
    `${base}?partNumber=${partNumber}&uploadId=${encodeURIComponent(uploadId)}` +
    `&X-Amz-Expires=${opts.expiresInSeconds}`;
  const headers: Record<string, string> = {
    "content-length": String(opts.contentLength),
  };
  const uploadUrl = await signQueryUrl(env, "PUT", url, headers);
  return {
    uploadUrl,
    requiredHeaders: headers,
    expiresAt: Date.now() + opts.expiresInSeconds * 1000,
  };
}

// Presign a GET with response-header overrides. The disposition + filename
// are signed into the URL so the backend applies them on response.
export async function presignGet(
  env: RoadieEnv,
  key: string,
  opts: {
    lifetimeSeconds: number;
    disposition: "inline" | "attachment";
    filename?: string;
  },
): Promise<{ url: string; expiresAt: number }> {
  const base = objectUrl(env, key);
  const contentDisposition =
    opts.filename !== undefined
      ? `${opts.disposition}; filename="${opts.filename.replace(/"/g, "")}"`
      : opts.disposition;
  const params = new URLSearchParams({
    "X-Amz-Expires": String(opts.lifetimeSeconds),
    "response-content-disposition": contentDisposition,
  });
  const url = `${base}?${params.toString()}`;
  const signed = await signQueryUrl(env, "GET", url, {});
  return { url: signed, expiresAt: Date.now() + opts.lifetimeSeconds * 1000 };
}

// --- S3 API operations for multipart lifecycle ---
// Upload-id namespace is tied to the S3 API; all multipart ops go here,
// not through the R2 binding. See ADR-RD-004.

function parseXmlValue(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : undefined;
}

export async function createMultipartUpload(
  env: RoadieEnv,
  key: string,
  opts: { contentType: string },
): Promise<{ uploadId: string }> {
  const url = `${objectUrl(env, key)}?uploads`;
  const res = await client(env).fetch(url, {
    method: "POST",
    headers: { "content-type": opts.contentType },
  });
  if (!res.ok) {
    throw new Error(
      `createMultipartUpload failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const body = await res.text();
  const uploadId = parseXmlValue(body, "UploadId");
  if (!uploadId) throw new Error("createMultipartUpload: missing UploadId in response");
  return { uploadId };
}

export async function completeMultipartUpload(
  env: RoadieEnv,
  key: string,
  uploadId: string,
  parts: Array<{ partNumber: number; etag: string }>,
): Promise<{ etag?: string }> {
  const url = `${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<CompleteMultipartUpload>` +
    parts
      .map((p) => `<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${p.etag}</ETag></Part>`)
      .join("") +
    `</CompleteMultipartUpload>`;
  const res = await client(env).fetch(url, {
    method: "POST",
    headers: { "content-type": "application/xml" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `completeMultipartUpload failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const text = await res.text();
  return { etag: parseXmlValue(text, "ETag") };
}

export async function abortMultipartUpload(
  env: RoadieEnv,
  key: string,
  uploadId: string,
): Promise<void> {
  const url = `${objectUrl(env, key)}?uploadId=${encodeURIComponent(uploadId)}`;
  const res = await client(env).fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `abortMultipartUpload failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
}
