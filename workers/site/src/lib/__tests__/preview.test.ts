import { describe, expect, it } from "vitest";

import {
  computePreviewSignature,
  previewSoftwareToDTO,
  previewTextToDTO,
  verifyPreview,
  type PreviewPayload,
} from "../preview";

// Operator-draft-preview HMAC verification (RFC-0001 D14, exec-plan 0004 T23).
// The signature is computed the SAME way the Operator signing fn computes it
// (HMAC-SHA256 over `${expiresAt}.${payloadJson}`, base64url) — these tests are
// the Site half of the shared contract, mirrored by operator's preview test.

const SECRET = "dev-preview-secret";

const textPayload: PreviewPayload = {
  kind: "text",
  title: "A Draft About Power",
  slug: "a-draft-about-power",
  deck: "Notes in progress",
  tags: ["power", "intimacy"],
  bodyMarkdown: "# Heading\n\nDraft body copy.",
  version: "draft",
  publishedAt: 1_700_000_000_000,
};

async function sign(payload: PreviewPayload, expiresAt: number, secret = SECRET) {
  const payloadJson = JSON.stringify(payload);
  const signature = await computePreviewSignature(secret, expiresAt, payloadJson);
  return { payloadJson, signature, expiresAt };
}

describe("verifyPreview", () => {
  it("accepts a well-signed, unexpired envelope and returns the parsed payload", async () => {
    const now = Date.now();
    const env = await sign(textPayload, now + 120_000);
    const res = await verifyPreview({ secret: SECRET, ...env, now });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.payload).toEqual(textPayload);
  });

  it("rejects a tampered payload as bad_signature (signature no longer matches)", async () => {
    const now = Date.now();
    const env = await sign(textPayload, now + 120_000);
    const tampered = env.payloadJson.replace("Draft body copy.", "Injected copy.");
    const res = await verifyPreview({ secret: SECRET, ...env, payloadJson: tampered, now });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a forged expiresAt as bad_signature (it is part of the signed message)", async () => {
    const now = Date.now();
    const env = await sign(textPayload, now + 120_000);
    const res = await verifyPreview({ secret: SECRET, ...env, expiresAt: now + 999_999_999, now });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature minted with the wrong secret", async () => {
    const now = Date.now();
    const env = await sign(textPayload, now + 120_000, "not-the-secret");
    const res = await verifyPreview({ secret: SECRET, ...env, now });
    expect(res).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired-but-correctly-signed envelope as expired", async () => {
    const now = Date.now();
    const env = await sign(textPayload, now - 1);
    const res = await verifyPreview({ secret: SECRET, ...env, now });
    expect(res).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a non-numeric expiry as malformed", async () => {
    const res = await verifyPreview({
      secret: SECRET,
      payloadJson: "{}",
      signature: "x",
      expiresAt: Number.NaN,
    });
    expect(res).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a signed but structurally invalid payload as malformed", async () => {
    const now = Date.now();
    const payloadJson = JSON.stringify({ kind: "text", title: 5 });
    const signature = await computePreviewSignature(SECRET, now + 120_000, payloadJson);
    const res = await verifyPreview({
      secret: SECRET,
      payloadJson,
      signature,
      expiresAt: now + 120_000,
      now,
    });
    expect(res).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("preview DTO adapters", () => {
  it("maps a text payload to a PublishedTextDTO with preview-safe defaults", () => {
    const dto = previewTextToDTO(textPayload);
    expect(dto.id).toBe("preview");
    expect(dto.title).toBe(textPayload.title);
    expect(dto.bodyMarkdown).toBe(textPayload.bodyMarkdown);
    expect(dto.excerpt).toBe("Notes in progress");
    expect(dto.media).toEqual([]);
    expect(dto.heroMedia).toBeNull();
  });

  it("derives an excerpt from the body when the deck is empty", () => {
    const dto = previewTextToDTO({ ...textPayload, deck: null });
    expect(dto.excerpt).toBe("# Heading");
  });

  it("maps a software payload (name → title) to a PublishedSoftwareDTO", () => {
    const dto = previewSoftwareToDTO({
      kind: "software",
      name: "Gateway",
      slug: "gateway",
      deck: "An MCP gateway",
      whatItIsMarkdown: "Details.",
      destinationUrl: "https://example.com",
      actionLabel: "Open",
      updatedAt: 1_700_000_000_000,
    });
    expect(dto.title).toBe("Gateway");
    expect(dto.destinationUrl).toBe("https://example.com");
    expect(dto.media).toEqual([]);
  });
});
