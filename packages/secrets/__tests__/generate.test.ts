import { createPrivateKey } from "node:crypto";
import { describe, expect, test } from "vitest";
import { generateBetterAuthSecret, generateEd25519, publicFromPrivatePem } from "../src/generate";
import { DEV_DEFAULTS } from "../src/manifest";

// The well-known dev attestation public key committed in
// packages/config/src/bouncer-attestation.ts under kid "dev". Deriving it from
// the committed dev private key proves our key formats match the live verifier.
const DEV_PUBLIC_SPKI_B64 = "MCowBQYDK2VwAyEAfw6nHplwIGKJBTJeITzErHw5kQej7FjhrcNIWEbP5cg=";

describe("generateBetterAuthSecret", () => {
  test("is 32 random bytes, base64-encoded", () => {
    expect(Buffer.from(generateBetterAuthSecret(), "base64")).toHaveLength(32);
  });
  test("differs across calls", () => {
    expect(generateBetterAuthSecret()).not.toBe(generateBetterAuthSecret());
  });
});

describe("generateEd25519", () => {
  test("private is PKCS8 PEM with headers; public is Ed25519 SPKI base64", () => {
    const kp = generateEd25519();
    expect(kp.privatePem).toMatch(
      /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/,
    );
    expect(kp.publicSpkiB64).toMatch(/^MCowBQYDK2VwAyEA[A-Za-z0-9+/=]+$/);
    expect(() => createPrivateKey(kp.privatePem)).not.toThrow();
  });
  test("public half derives from its own private half", () => {
    const kp = generateEd25519();
    expect(publicFromPrivatePem(kp.privatePem)).toBe(kp.publicSpkiB64);
  });
});

describe("publicFromPrivatePem", () => {
  test("derives the committed dev public key from the committed dev private key", () => {
    expect(publicFromPrivatePem(DEV_DEFAULTS.BNC_ATT_PRIV ?? "")).toBe(DEV_PUBLIC_SPKI_B64);
  });
});
