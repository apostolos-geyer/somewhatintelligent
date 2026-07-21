/**
 * Operator draft-preview verification (RFC-0001 D14, exec-plan 0004 T23). Site
 * never binds a draft-read entrypoint (INV-SITE-1); instead the Access-protected
 * Operator POSTs the rendered draft document to `/__preview`, authenticated by an
 * HMAC-SHA256 over `${expiresAt}.${payloadJson}` that only Operator and Site
 * share (`PREVIEW_SIGNING_SECRET`). This module is pure (Web Crypto only, no
 * worker binding) so it is unit-tested in `__tests__/preview.test.ts` and the
 * signing side in Operator mirrors it byte-for-byte.
 *
 * The signature is verified over the EXACT `payloadJson` bytes received — never a
 * re-canonicalization — so Operator and Site cannot disagree on serialization.
 */
import type { PageDocumentByKey, PageKey } from "@si/contracts";

/** ~120s validity window; Operator mints `expiresAt = now + PREVIEW_TTL_MS`. */
export const PREVIEW_TTL_MS = 120_000;

/** The draft document travelling in the request, discriminated by `kind`. Draft
 *  media is not publicly resolvable, so previews carry copy/markdown only — image
 *  slots render as the same placeholders the public pages show for missing media. */
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

const enc = new TextEncoder();

/** URL-safe base64 of raw bytes (no padding) — `btoa` is available in workers
 *  and Node, so this stays binding-free and test-portable. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** HMAC-SHA256 of `${expiresAt}.${payloadJson}`, base64url-encoded. The signing
 *  side (Operator) computes this identically. */
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

/** Length-independent constant-time string compare — avoids leaking how many
 *  leading signature bytes matched via response timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isPreviewPayload(value: unknown): value is PreviewPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  switch (v.kind) {
    case "text":
      return (
        typeof v.title === "string" &&
        typeof v.slug === "string" &&
        (v.deck === null || typeof v.deck === "string") &&
        Array.isArray(v.tags) &&
        typeof v.bodyMarkdown === "string" &&
        typeof v.version === "string" &&
        typeof v.publishedAt === "number"
      );
    case "software":
      return (
        typeof v.name === "string" &&
        typeof v.slug === "string" &&
        typeof v.deck === "string" &&
        typeof v.whatItIsMarkdown === "string" &&
        typeof v.destinationUrl === "string" &&
        typeof v.actionLabel === "string" &&
        typeof v.updatedAt === "number"
      );
    case "page":
      return typeof v.key === "string" && typeof v.document === "object" && v.document !== null;
    default:
      return false;
  }
}

export type PreviewVerifyResult =
  | { ok: true; payload: PreviewPayload }
  | { ok: false; reason: "expired" | "bad_signature" | "malformed" };

/**
 * Verify a posted preview envelope. The signature is checked BEFORE expiry (a
 * forged expiresAt changes the signed message and fails the HMAC), and payload
 * shape is validated only after the HMAC passes, so an unauthenticated caller
 * learns nothing beyond `bad_signature`.
 */
export async function verifyPreview(input: {
  secret: string;
  payloadJson: string;
  signature: string;
  expiresAt: number;
  now?: number;
}): Promise<PreviewVerifyResult> {
  const { secret, payloadJson, signature, expiresAt, now = Date.now() } = input;
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return { ok: false, reason: "malformed" };

  const expected = await computePreviewSignature(secret, expiresAt, payloadJson);
  if (!timingSafeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };
  if (now > expiresAt) return { ok: false, reason: "expired" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isPreviewPayload(parsed)) return { ok: false, reason: "malformed" };
  return { ok: true, payload: parsed };
}

// ── Draft → public DTO adapters (pure) ─────────────────────────────────────────
// A preview payload carries only what the operator edits; these fill the fields
// the public render DTOs also require, using preview-safe defaults (synthetic id,
// no resolved media) so a text/software preview renders through the SAME view
// components as `/writing/:slug` and `/software/:slug`.

import type { PublishedSoftwareDTO, PublishedTextDTO } from "@si/contracts";

/** First non-empty line of markdown, trimmed to ~200 chars — a stand-in excerpt
 *  when the draft has no deck. */
function deriveExcerpt(deck: string | null, body: string): string {
  if (deck && deck.trim()) return deck.trim();
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return firstLine ? firstLine.slice(0, 200) : "";
}

export function previewTextToDTO(
  payload: Extract<PreviewPayload, { kind: "text" }>,
): PublishedTextDTO {
  return {
    id: "preview",
    slug: payload.slug,
    version: payload.version,
    title: payload.title,
    deck: payload.deck,
    excerpt: deriveExcerpt(payload.deck, payload.bodyMarkdown),
    publishedAt: payload.publishedAt,
    tags: payload.tags,
    heroMedia: null,
    bodyMarkdown: payload.bodyMarkdown,
    media: [],
  };
}

export function previewSoftwareToDTO(
  payload: Extract<PreviewPayload, { kind: "software" }>,
): PublishedSoftwareDTO {
  return {
    id: "preview",
    slug: payload.slug,
    title: payload.name,
    deck: payload.deck,
    primaryMedia: null,
    updatedAt: payload.updatedAt,
    whatItIsMarkdown: payload.whatItIsMarkdown,
    destinationUrl: payload.destinationUrl,
    actionLabel: payload.actionLabel,
    media: [],
  };
}
