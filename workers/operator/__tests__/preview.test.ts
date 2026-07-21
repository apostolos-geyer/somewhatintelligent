import {
  PREVIEW_TTL_MS,
  computePreviewSignature,
  signPreviewPayload,
  type PreviewPayload,
} from "../src/lib/preview";

// Operator draft-preview signing contract (RFC-0001 D14, exec-plan 0004 T23).
// The signed message is `${expiresAt}.${payloadJson}` (payloadJson = the exact
// JSON transmitted), HMAC-SHA256 base64url — Site's verify side mirrors this.

const SECRET = "dev-preview-secret";

const payload: PreviewPayload = {
  kind: "text",
  title: "A Draft About Power",
  slug: "a-draft-about-power",
  deck: null,
  tags: ["power"],
  bodyMarkdown: "Draft body.",
  version: "draft",
  publishedAt: 1_700_000_000_000,
};

describe("signPreviewPayload", () => {
  test("serializes the exact payload and mints a ~120s expiry", async () => {
    const now = 1_700_000_000_000;
    const signed = await signPreviewPayload(SECRET, payload, now);
    expect(signed.payloadJson).toBe(JSON.stringify(payload));
    expect(signed.expiresAt).toBe(now + PREVIEW_TTL_MS);
  });

  test("signs over `${expiresAt}.${payloadJson}` — recomputable byte-for-byte", async () => {
    const now = 1_700_000_000_000;
    const signed = await signPreviewPayload(SECRET, payload, now);
    const expected = await computePreviewSignature(SECRET, signed.expiresAt, signed.payloadJson);
    expect(signed.signature).toBe(expected);
  });

  test("is deterministic for identical inputs", async () => {
    const now = 1_700_000_000_000;
    const a = await signPreviewPayload(SECRET, payload, now);
    const b = await signPreviewPayload(SECRET, payload, now);
    expect(a.signature).toBe(b.signature);
  });

  test("a different payload yields a different signature at the same expiry", async () => {
    const now = 1_700_000_000_000;
    const a = await signPreviewPayload(SECRET, payload, now);
    const b = await signPreviewPayload(SECRET, { ...payload, title: "Tampered" }, now);
    expect(a.signature).not.toBe(b.signature);
  });

  test("a different secret yields a different signature", async () => {
    const now = 1_700_000_000_000;
    const a = await signPreviewPayload(SECRET, payload, now);
    const b = await signPreviewPayload("other-secret", payload, now);
    expect(a.signature).not.toBe(b.signature);
  });
});
