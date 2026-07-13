/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// KEK rotation (FR-13, §7): batched rewrap V1→V2, convergent re-invocation
// (resumability), old-epoch wraps unusable, payloads intact throughout.
import { env, runInDurableObject } from "cloudflare:test";
import { unwrapDek } from "../src/crypto/envelope";
import { base64Decode } from "../src/crypto/keys";
import * as adminM from "../src/methods/admin";
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { echoApi, installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({ "api.vercel.com": echoApi });
});
afterEach(() => upstream.restore());

const N = 30; // > the DO's batch size of 25, so rotation takes two calls

describe("rotateKek", () => {
  test("rewraps the fleet V1→V2 in batches; payloads survive; V1 can no longer unwrap", async () => {
    const tenantId = uniqueTenant();
    for (let i = 0; i < N; i++) {
      const r = await grantsM.put(
        makeVault(),
        {
          tenantId,
          dest: "vercel",
          label: `key-${String(i).padStart(2, "0")}`,
          material: { kind: "api_key", apiKey: `secret-${i}` },
        },
        META,
      );
      expect(r.ok).toBe(true);
    }
    const stub = tenantStubFor(tenantId);
    const before = await runInDurableObject(stub, async (_i, state) => {
      return [
        ...state.storage.sql.exec("SELECT grant_id, ciphertext, kek_version FROM grants"),
      ].map((r) => r as { grant_id: string; ciphertext: ArrayBuffer; kek_version: number });
    });
    expect(before).toHaveLength(N);
    expect(before.every((r) => r.kek_version === 1)).toBe(true);

    // First batch: 25 of 30.
    const first = await adminM.rotateKek(makeVault(), { tenantId, toVersion: 2 }, META);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value).toMatchObject({ done: false, rewrapped: 25, remaining: 5, kekVersion: 2 });

    // Re-invocation converges (this is also the crash-resume story: the
    // kek_version != target predicate makes any partial run resumable).
    const second = await adminM.rotateKek(makeVault(), { tenantId, toVersion: 2 }, META);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toMatchObject({ done: true, rewrapped: 5, remaining: 0 });

    // Idempotent once done.
    const third = await adminM.rotateKek(makeVault(), { tenantId, toVersion: 2 }, META);
    expect(third.ok && third.value.rewrapped).toBe(0);

    await runInDurableObject(stub, async (_i, state) => {
      const after = [
        ...state.storage.sql.exec(
          "SELECT grant_id, ciphertext, dek_wrapped, kek_version FROM grants",
        ),
      ].map(
        (r) =>
          r as {
            grant_id: string;
            ciphertext: ArrayBuffer;
            dek_wrapped: ArrayBuffer;
            kek_version: number;
          },
      );
      expect(after.every((r) => r.kek_version === 2)).toBe(true);
      // Re-sealed: ciphertext bytes changed (AAD binds the new epoch).
      const beforeById = new Map(before.map((r) => [r.grant_id, r.ciphertext]));
      for (const row of after) {
        expect(new Uint8Array(row.ciphertext)).not.toEqual(
          new Uint8Array(beforeById.get(row.grant_id)!),
        );
      }
      // The rotated wrap is bound to V2 — V1 can no longer unwrap it.
      const kekV1 = await crypto.subtle.importKey(
        "raw",
        base64Decode(env.VAULT_KEK_V1) as BufferSource,
        { name: "AES-KW" },
        false,
        ["wrapKey", "unwrapKey"],
      );
      await expect(unwrapDek(new Uint8Array(after[0]!.dek_wrapped), kekV1)).rejects.toThrow();
    });

    // Spend still works end-to-end after rotation.
    const spend = await spendM.inject(
      makeVault(),
      {
        tenantId,
        dest: "vercel",
        label: "key-00",
        request: { url: "https://api.vercel.com/v9/x" },
      },
      META,
    );
    expect(spend.ok).toBe(true);
    const [req] = upstream.to("api.vercel.com");
    expect(req!.headers.authorization).toBe("Bearer secret-0");
  });

  test("a missing target KEK binding fails the rotation up front", async () => {
    const tenantId = uniqueTenant();
    await grantsM.put(
      makeVault(),
      { tenantId, dest: "vercel", label: "k", material: { kind: "api_key", apiKey: "s" } },
      META,
    );
    const r = await adminM.rotateKek(makeVault(), { tenantId, toVersion: 9 }, META);
    expect(!r.ok && r.error).toBe("kek_unavailable");
  });

  test("a tampered grant is surfaced via health, not silently skipped — and cannot wedge `done`", async () => {
    const tenantId = uniqueTenant();
    for (const label of ["good", "bad"]) {
      await grantsM.put(
        makeVault(),
        {
          tenantId,
          dest: "vercel",
          label,
          material: { kind: "api_key", apiKey: `${label}-secret` },
        },
        META,
      );
    }
    await runInDurableObject(tenantStubFor(tenantId), async (_i, state) => {
      state.storage.sql.exec("UPDATE grants SET ciphertext = X'00000000' WHERE label = 'bad'");
    });
    const r = await adminM.rotateKek(makeVault(), { tenantId, toVersion: 2 }, META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ done: true, rewrapped: 1, remaining: 0 });
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "vercel" }, META);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.find((g) => g.label === "bad")).toMatchObject({
      health: "unhealthy",
      unhealthyReason: "tampered",
    });
    expect(listed.value.find((g) => g.label === "good")!.health).toBe("ok");
  });
});
