/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Envelope-engine invariants, run inside workerd: the first test doubles as
// the AES-KW availability canary the whole design rests on.
import type { AadParts } from "../src/crypto/aad";
import {
  generateDek,
  importDek,
  openPayload,
  sealPayload,
  unwrapDek,
  wrapDek,
  type GrantPayload,
} from "../src/crypto/envelope";

const KEK_A = crypto.getRandomValues(new Uint8Array(32));
const KEK_B = crypto.getRandomValues(new Uint8Array(32));

function importKek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-KW" }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

const AAD: AadParts = {
  tenantId: "tenant-1",
  dest: "stripe",
  label: "sandbox",
  env: "test",
  grantId: "grant-1",
  kekVersion: 1,
};

const PAYLOAD: GrantPayload = {
  kind: "api_key",
  apiKey: "sk_test_supersecret",
  scopes: [],
  obtainedAt: 1,
};

describe("envelope engine", () => {
  test("AES-KW is available in workerd: DEK wrap/unwrap round-trips", async () => {
    const kek = await importKek(KEK_A);
    const dek = await importDek(generateDek());
    const wrapped = await wrapDek(dek, kek);
    expect(wrapped.byteLength).toBe(40); // AES-KW: 32-byte key + 8-byte IV block
    const unwrapped = await unwrapDek(wrapped, kek);
    expect(unwrapped.type).toBe("secret");
    expect(unwrapped.extractable).toBe(false);
  });

  test("unwrap with the wrong KEK throws", async () => {
    const kekA = await importKek(KEK_A);
    const kekB = await importKek(KEK_B);
    const dek = await importDek(generateDek());
    const wrapped = await wrapDek(dek, kekA);
    await expect(unwrapDek(wrapped, kekB)).rejects.toThrow();
  });

  test("seal/open round-trips a payload under AAD", async () => {
    const dek = await importDek(generateDek());
    const sealed = await sealPayload(PAYLOAD, dek, AAD);
    const opened = await openPayload(sealed, dek, AAD);
    expect(opened).toEqual(PAYLOAD);
  });

  test("a flipped ciphertext byte fails authentication", async () => {
    const dek = await importDek(generateDek());
    const sealed = await sealPayload(PAYLOAD, dek, AAD);
    sealed.ciphertext[0]! ^= 0xff;
    await expect(openPayload(sealed, dek, AAD)).rejects.toThrow();
  });

  test.each([
    ["tenantId", { tenantId: "tenant-2" }],
    ["dest", { dest: "vercel" }],
    ["label", { label: "live" }],
    ["env", { env: "live" as const }],
    ["env null-vs-set", { env: null }],
    ["grantId", { grantId: "grant-2" }],
    ["kekVersion", { kekVersion: 2 }],
  ])("AAD component flip (%s) fails authentication", async (_name, patch) => {
    const dek = await importDek(generateDek());
    const sealed = await sealPayload(PAYLOAD, dek, AAD);
    await expect(openPayload(sealed, dek, { ...AAD, ...patch })).rejects.toThrow();
  });
});
