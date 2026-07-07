/**
 * Unit test for `normalizePrivPem` (`src/lib/pem.ts`) — the BUG-04 regression.
 *
 * The dev attestation key ships in `.dev.vars` on one line with escaped newlines.
 * Passed raw to `importPKCS8` it throws "Invalid PKCS8 input", which silently
 * disabled the dev-envelope stamper and the Durable-Object / WebSocket auth path
 * (Group Chat send, feed live fan-out). Normalizing the newlines makes the key
 * importable. This test pins both halves: raw fails, normalized imports.
 */
import { describe, expect, it } from "vitest";
import { importPKCS8 } from "jose";
import { normalizePrivPem } from "@/lib/pem";

// The well-known local dev Ed25519 key, exactly as stored in .dev.vars (escaped).
const ESCAPED_DEV_KEY =
  "-----BEGIN PRIVATE KEY-----\\nMC4CAQAwBQYDK2VwBCIEINzNgiuDD9xbqVEPkfMt8twPcq7hTnIbAdKKHPjM7TmU\\n-----END PRIVATE KEY-----";

describe("normalizePrivPem", () => {
  it("converts escaped \\n into real newlines", () => {
    const out = normalizePrivPem(ESCAPED_DEV_KEY);
    expect(out.includes("\\n")).toBe(false);
    expect(out.split("\n")).toHaveLength(3);
  });

  it("is a no-op for a value that already has real newlines", () => {
    const real = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----";
    expect(normalizePrivPem(real)).toBe(real);
  });

  it("returns '' for nullish input", () => {
    expect(normalizePrivPem(undefined)).toBe("");
    expect(normalizePrivPem(null)).toBe("");
    expect(normalizePrivPem("")).toBe("");
  });

  it("the raw escaped key fails importPKCS8 but the normalized key imports (BUG-04)", async () => {
    await expect(importPKCS8(ESCAPED_DEV_KEY, "EdDSA")).rejects.toThrow();
    const key = await importPKCS8(normalizePrivPem(ESCAPED_DEV_KEY), "EdDSA");
    expect(key).toBeDefined();
  });
});
