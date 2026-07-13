/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// killTenant (FR-5): revoke-and-destroy everything for a tenant; neighbors
// untouched (NFR-2 isolation).
import * as adminM from "../src/methods/admin";
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, uniqueTenant } from "./helpers";
import { installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({
    "api.github.com": () => new Response(null, { status: 204 }),
  });
});
afterEach(() => upstream.restore());

describe("killTenant", () => {
  test("revokes where possible, destroys all grants, leaves other tenants intact", async () => {
    const victim = uniqueTenant("victim");
    const neighbor = uniqueTenant("neighbor");
    await grantsM.put(
      makeVault(),
      { tenantId: victim, dest: "vercel", label: "a", material: { kind: "api_key", apiKey: "k1" } },
      META,
    );
    await grantsM.put(
      makeVault(),
      {
        tenantId: victim,
        dest: "stripe",
        label: "s",
        material: { kind: "api_key", apiKey: "sk_test_1" },
      },
      META,
    );
    await grantsM.put(
      makeVault(),
      {
        tenantId: victim,
        dest: "github",
        label: "g",
        material: { kind: "oauth", accessToken: "gho", refreshToken: "ghr" },
      },
      META,
    );
    await grantsM.put(
      makeVault(),
      {
        tenantId: neighbor,
        dest: "vercel",
        label: "a",
        material: { kind: "api_key", apiKey: "k2" },
      },
      META,
    );

    const killed = await adminM.killTenant(makeVault(), { tenantId: victim }, META);
    expect(killed.ok && killed.value.grants).toBe(3);
    // The github grant's revoke endpoint was called.
    expect(upstream.to("api.github.com")).toHaveLength(1);

    const gone = await grantsM.list(makeVault(), { tenantId: victim }, META);
    expect(gone.ok && gone.value).toEqual([]);
    const spend = await spendM.inject(
      makeVault(),
      { tenantId: victim, dest: "vercel", request: { url: "https://api.vercel.com/x" } },
      META,
    );
    expect(!spend.ok && spend.error).toBe("grant_missing");

    const neighborList = await grantsM.list(makeVault(), { tenantId: neighbor }, META);
    expect(neighborList.ok && neighborList.value).toHaveLength(1);
  });
});
