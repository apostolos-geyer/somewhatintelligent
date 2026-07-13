/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Entry surface: tenant→DO isolation, input validation, and the REAL RPC
// entrypoint via the self-referencing VAULT_RPC service binding (typed
// Service<typeof Vault>) — including ArrayBuffer results over the two hops.
import { env, runInDurableObject } from "cloudflare:test";
import * as grantsM from "../src/methods/grants";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { echoApi, installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({ "api.vercel.com": echoApi });
});
afterEach(() => upstream.restore());

describe("tenant isolation", () => {
  test("two tenants with identical refs live in separate DOs and never see each other", async () => {
    const a = uniqueTenant("iso-a");
    const b = uniqueTenant("iso-b");
    for (const [tenantId, key] of [
      [a, "key-of-a"],
      [b, "key-of-b"],
    ] as const) {
      await grantsM.put(
        makeVault(),
        { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: key } },
        META,
      );
    }
    // Each DO's private database holds exactly its own row.
    for (const tenantId of [a, b]) {
      await runInDurableObject(tenantStubFor(tenantId), async (_i, state) => {
        const rows = [...state.storage.sql.exec("SELECT COUNT(*) AS n FROM grants")];
        expect((rows[0] as { n: number }).n).toBe(1);
      });
    }
    const listA = await grantsM.list(makeVault(), { tenantId: a }, META);
    expect(listA.ok && listA.value.map((g) => `${g.dest}/${g.label}`)).toEqual(["vercel/main"]);
  });

  test("a DO refuses calls routed under a different tenant identity", async () => {
    const tenantId = uniqueTenant();
    await grantsM.put(
      makeVault(),
      { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    // Call the instance directly so the throw is caught inside the isolate
    // (a raw stub call also rejects, but the pool then reports the DO-side
    // exception as an unhandled error).
    await runInDurableObject(tenantStubFor(tenantId), async (instance) => {
      await expect(
        instance.list({ tenantId: "someone-else" }, { callerApp: "test-app" }),
      ).rejects.toThrow(/tenant identity mismatch/);
    });
  });

  test("malformed tenant ids are rejected at the entry boundary", async () => {
    const r = await grantsM.list(makeVault(), { tenantId: "bad|pipe" }, META);
    expect(!r.ok && r.error).toBe("tenant_invalid");
  });
});

describe("full RPC surface (VAULT_RPC self-binding)", () => {
  test("put → inject → del over the real entrypoint, ArrayBuffer intact across hops", async () => {
    const tenantId = uniqueTenant("rpc");
    const put = await env.VAULT_RPC.put(
      { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: "rpc-key" } },
      META,
    );
    expect(put.ok).toBe(true);

    const injected = await env.VAULT_RPC.inject(
      {
        tenantId,
        dest: "vercel",
        request: { url: "https://api.vercel.com/v9/projects", method: "POST", body: "ping" },
      },
      META,
    );
    expect(injected.ok).toBe(true);
    if (!injected.ok) return;
    expect(injected.value.status).toBe(200);
    expect(injected.value.headers["x-vault-grant"]).toBe("vercel/main");
    const parsed = JSON.parse(new TextDecoder().decode(injected.value.body)) as { echo: string };
    expect(parsed.echo).toBe("ping");
    const [req] = upstream.to("api.vercel.com");
    expect(req!.headers.authorization).toBe("Bearer rpc-key");

    const del = await env.VAULT_RPC.del({ tenantId, dest: "vercel", label: "main" }, META);
    expect(del.ok).toBe(true);
  });

  test("thrown internals surface as the internal_error result, never raw", async () => {
    // meta validation happens inside the instrumented scope — a garbage meta
    // must come back as a typed error, not an exception.
    const r = await env.VAULT_RPC.list({ tenantId: uniqueTenant() }, {
      bogus: true,
    } as unknown as typeof META);
    expect(!r.ok && r.error).toBe("internal_error");
  });
});
