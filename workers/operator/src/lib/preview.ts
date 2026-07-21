/**
 * Operator draft-preview signing (RFC-0001 D14, exec-plan 0004 T23). Only the
 * Access-protected Operator can mint a preview: it HMAC-SHA256-signs the draft
 * document with the shared `PREVIEW_SIGNING_SECRET`, and Site verifies over the
 * exact transmitted bytes. This module is pure (Web Crypto only) and its format
 * is byte-identical to Site's `lib/preview.ts` verify side — unit-tested in
 * `__tests__/preview.test.ts`.
 */
import type { PageDocumentByKey, PageKey } from "@si/contracts";

/** ~120s validity window. */
export const PREVIEW_TTL_MS = 120_000;

/** The draft document travelling in the request, discriminated by `kind`. */
export type PreviewPayload =
  | {
      kind: "text";
      title: string;
      slug: string;
      deck: string | null;
      tags: string[];
      bodyMarkdown: string;
      version: string;
      publishedAt: number;
    }
  | {
      kind: "software";
      name: string;
      slug: string;
      deck: string;
      whatItIsMarkdown: string;
      destinationUrl: string;
      actionLabel: string;
      updatedAt: number;
    }
  | { kind: "page"; key: PageKey; document: PageDocumentByKey[PageKey] };

export interface SignedPreview {
  payloadJson: string;
  signature: string;
  expiresAt: number;
}

const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 of `${expiresAt}.${payloadJson}`, base64url-encoded. Site's verify
 *  side computes this identically. */
export async function computePreviewSignature(
  secret: string,
  expiresAt: number,
  payloadJson: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${expiresAt}.${payloadJson}`));
  return base64url(new Uint8Array(sig));
}

/** Serialize + sign a preview payload. `payloadJson` is the exact string Site
 *  will verify over, so the caller transmits it unchanged. */
export async function signPreviewPayload(
  secret: string,
  payload: PreviewPayload,
  now: number = Date.now(),
): Promise<SignedPreview> {
  const payloadJson = JSON.stringify(payload);
  const expiresAt = now + PREVIEW_TTL_MS;
  const signature = await computePreviewSignature(secret, expiresAt, payloadJson);
  return { payloadJson, signature, expiresAt };
}
