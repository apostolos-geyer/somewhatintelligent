/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Race-free refresh (FR-9): N concurrent spends against an expired grant
// produce exactly ONE upstream refresh; failure semantics per FR-10.
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, uniqueTenant } from "./helpers";
import { installUpstream, mockOAuthProvider, type Upstream } from "./upstream-mock";

let upstream: Upstream | undefined;
afterEach(() => upstream?.restore());

async function putExpiredGithub(tenantId: string) {
  const r = await grantsM.put(
    makeVault(),
    {
      tenantId,
      dest: "github",
      label: "main",
      material: {
        kind: "oauth",
        accessToken: "gho_stale",
        refreshToken: "ghr_refresh",
        expiresAt: Date.now() - 1_000, // already expired
        scopes: ["repo"],
      },
    },
    META,
  );
  expect(r.ok).toBe(true);
}

describe("single-flight refresh", () => {
  test("10 concurrent getToken on an expired grant → exactly 1 upstream refresh", async () => {
    const provider = mockOAuthProvider({ delayMs: 30 });
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await putExpiredGithub(tenantId);

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        spendM.getToken(makeVault(), { tenantId, dest: "github" }, META),
      ),
    );
    expect(provider.state.refreshes).toBe(1);
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.token).toBe("refreshed-token-1");
    }
    // The stored grant now carries the new expiry.
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok && (listed.value[0]!.expiresAt ?? 0) > Date.now()).toBe(true);
  });

  test("provider 4xx on refresh → refresh_failed + unhealthy(revoked_upstream)", async () => {
    const provider = mockOAuthProvider({ refreshStatus: 400 });
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await putExpiredGithub(tenantId);

    const r = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(!r.ok && r.error).toBe("refresh_failed");
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok && listed.value[0]).toMatchObject({
      health: "unhealthy",
      unhealthyReason: "revoked_upstream",
    });
    // Subsequent spends fail at selection — grant_unhealthy, no fallback.
    const again = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(!again.ok && again.error).toBe("grant_unhealthy");
  });

  test("provider 5xx on refresh → refresh_failed, health stays ok (transient)", async () => {
    const provider = mockOAuthProvider({ refreshStatus: 503 });
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await putExpiredGithub(tenantId);

    const r = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(!r.ok && r.error).toBe("refresh_failed");
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "github" }, META);
    expect(listed.ok && listed.value[0]!.health).toBe("ok");
  });

  test("an unexpired grant spends without touching the token endpoint", async () => {
    const provider = mockOAuthProvider();
    upstream = installUpstream({ "github.com": provider.handler });
    const tenantId = uniqueTenant();
    await grantsM.put(
      makeVault(),
      {
        tenantId,
        dest: "github",
        label: "main",
        material: {
          kind: "oauth",
          accessToken: "gho_fresh",
          refreshToken: "ghr",
          expiresAt: Date.now() + 3_600_000,
        },
      },
      META,
    );
    const r = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.token).toBe("gho_fresh");
    expect(provider.state.refreshes).toBe(0);
  });
});
