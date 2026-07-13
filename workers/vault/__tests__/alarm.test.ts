/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Expiry hygiene sweep (FR-10): the DO alarm proactively refreshes
// near-expiry grants and surfaces unrefreshable ones via health.
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import * as grantsM from "../src/methods/grants";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { installUpstream, mockOAuthProvider, type Upstream } from "./upstream-mock";

let upstream: Upstream | undefined;
afterEach(() => upstream?.restore());

async function putNearExpiryGithub(tenantId: string) {
  const r = await grantsM.put(
    makeVault(),
    {
      tenantId,
      dest: "github",
      label: "main",
      material: {
        kind: "oauth",
        accessToken: "gho_soon_stale",
        refreshToken: "ghr_refresh",
        // Inside the 300s refresh lead, not yet expired.
        expiresAt: Date.now() + 60_000,
        scopes: ["repo"],
      },
    },
    META,
  );
  expect(r.ok).toBe(true);
}

describe("alarm sweep", () => {
  test("put arms the alarm; the sweep refreshes a near-expiry grant", async () => {
    const provider = mockOAuthProvider();
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await putNearExpiryGithub(tenantId);

    const stub = tenantStubFor(tenantId);
    await runInDurableObject(stub, async (_i, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);
    expect(provider.state.refreshes).toBe(1);

    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value[0]!.health).toBe("ok");
    // Refreshed an hour out — beyond the sweep lead now.
    expect(listed.value[0]!.expiresAt ?? 0).toBeGreaterThan(Date.now() + 600_000);
    // Rescheduled for the next expiry.
    await runInDurableObject(stub, async (_i, state) => {
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
  });

  test("sweep marks a permanently-unrefreshable grant unhealthy(revoked_upstream)", async () => {
    const provider = mockOAuthProvider({ refreshStatus: 401 });
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await putNearExpiryGithub(tenantId);

    const ran = await runDurableObjectAlarm(tenantStubFor(tenantId));
    expect(ran).toBe(true);
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok && listed.value[0]).toMatchObject({
      health: "unhealthy",
      unhealthyReason: "revoked_upstream",
    });
  });

  test("sweep marks a network-unreachable refresh unhealthy(network)", async () => {
    upstream = installUpstream({
      "github.com": () => {
        throw new Error("connection refused");
      },
    });
    const tenantId = uniqueTenant();
    await putNearExpiryGithub(tenantId);

    const ran = await runDurableObjectAlarm(tenantStubFor(tenantId));
    expect(ran).toBe(true);
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok && listed.value[0]).toMatchObject({
      health: "unhealthy",
      unhealthyReason: "network",
    });
  });

  test("no refreshable grants → no alarm armed", async () => {
    const tenantId = uniqueTenant();
    upstream = installUpstream({});
    await grantsM.put(
      makeVault(),
      { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: "vk" } },
      META,
    );
    await runInDurableObject(tenantStubFor(tenantId), async (_i, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
});
