/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// getToken (FR-8): access material only — never refresh tokens; raw keys
// only where the registry opts in.
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, uniqueTenant } from "./helpers";
import { installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({});
});
afterEach(() => upstream.restore());

describe("getToken", () => {
  test("returns OAuth access material — and never the refresh token", async () => {
    const tenantId = uniqueTenant();
    const expiresAt = Date.now() + 3_600_000;
    await grantsM.put(
      makeVault(),
      {
        tenantId,
        dest: "github",
        label: "main",
        material: {
          kind: "oauth",
          accessToken: "gho_access",
          refreshToken: "ghr_REFRESH_NEVER_LEAVES",
          expiresAt,
          scopes: ["repo"],
        },
      },
      META,
    );
    const r = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ token: "gho_access", expiresAt, scopes: ["repo"], env: null });
    expect(JSON.stringify(r)).not.toContain("ghr_REFRESH_NEVER_LEAVES");
  });

  test("api_key destinations are getToken-disabled unless the registry opts in", async () => {
    const tenantId = uniqueTenant();
    await grantsM.put(
      makeVault(),
      { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: "vk" } },
      META,
    );
    const r = await spendM.getToken(makeVault(), { tenantId, dest: "vercel" }, META);
    expect(!r.ok && r.error).toBe("get_token_disabled");
  });
});
