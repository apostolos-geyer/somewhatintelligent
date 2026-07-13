/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Ciphertext-at-rest: after put, a raw scan of the tenant DO's SQLite finds
// no trace of the plaintext credential; wraps are unusable under the wrong
// KEK. (PRD §11 "Ciphertext-at-rest".)
import { env, runInDurableObject } from "cloudflare:test";
import { unwrapDek } from "../src/crypto/envelope";
import { base64Decode } from "../src/crypto/keys";
import * as grantsM from "../src/methods/grants";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";

const SECRET = "sk_test_THISISTHEPLAINTEXTSECRET42";
const REFRESH_SECRET = "REFRESHTOKENPLAINTEXT99";

async function scanStorage(tenantId: string): Promise<string> {
  const stub = tenantStubFor(tenantId);
  return runInDurableObject(stub, async (_instance, state) => {
    const chunks: string[] = [];
    const tables = [...state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table'")]
      .map((r) => (r as { name: string }).name)
      .filter((n) => !n.startsWith("_") && !n.startsWith("sqlite_"));
    const decoder = new TextDecoder("utf-8", { fatal: false });
    for (const table of tables) {
      for (const row of state.storage.sql.exec(`SELECT * FROM ${table}`)) {
        for (const value of Object.values(row as Record<string, unknown>)) {
          if (value instanceof ArrayBuffer) {
            chunks.push(decoder.decode(value));
          } else {
            chunks.push(String(value));
          }
        }
      }
    }
    return chunks.join("\n");
  });
}

describe("ciphertext at rest", () => {
  test("no plaintext token substring survives anywhere in the DO database", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    const put = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "sandbox",
        material: { kind: "api_key", apiKey: SECRET },
      },
      META,
    );
    expect(put.ok).toBe(true);
    const putOauth = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "github",
        label: "main",
        material: {
          kind: "oauth",
          accessToken: "gho_ACCESSTOKENPLAINTEXT",
          refreshToken: REFRESH_SECRET,
          expiresAt: Date.now() + 3_600_000,
        },
      },
      META,
    );
    expect(putOauth.ok).toBe(true);

    const dump = await scanStorage(tenantId);
    expect(dump.length).toBeGreaterThan(0);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("THISISTHEPLAINTEXTSECRET");
    expect(dump).not.toContain("ACCESSTOKENPLAINTEXT");
    expect(dump).not.toContain(REFRESH_SECRET);
  });

  test("stored DEK wrap is unusable under the wrong KEK version", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    await grantsM.put(
      vault,
      {
        tenantId,
        dest: "vercel",
        label: "main",
        material: { kind: "api_key", apiKey: "vc_key_1" },
      },
      META,
    );
    const stub = tenantStubFor(tenantId);
    await runInDurableObject(stub, async (_instance, state) => {
      const row = [...state.storage.sql.exec("SELECT dek_wrapped FROM grants")][0] as {
        dek_wrapped: ArrayBuffer;
      };
      const wrongKek = await crypto.subtle.importKey(
        "raw",
        base64Decode(env.VAULT_KEK_V2) as BufferSource,
        { name: "AES-KW" },
        false,
        ["wrapKey", "unwrapKey"],
      );
      await expect(unwrapDek(new Uint8Array(row.dek_wrapped), wrongKek)).rejects.toThrow();
    });
  });

  test("list() exposes metadata only — never token fragments", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    await grantsM.put(
      vault,
      { tenantId, dest: "stripe", label: "sandbox", material: { kind: "api_key", apiKey: SECRET } },
      META,
    );
    const listed = await grantsM.list(vault, { tenantId }, META);
    expect(listed.ok).toBe(true);
    const dump = JSON.stringify(listed);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain("sk_test_THISIS");
  });
});
