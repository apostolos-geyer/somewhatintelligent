/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// OAuth lifecycle (FR-2): begin → callback happy path against a mock
// provider; state is signed, single-use, TTL-bound, and binding-bound.
import * as grantsM from "../src/methods/grants";
import * as oauthM from "../src/methods/oauth";
import * as spendM from "../src/methods/spend";
import { makeVault, META, uniqueTenant } from "./helpers";
import { installUpstream, mockOAuthProvider, type Upstream } from "./upstream-mock";

const REDIRECT = "https://consumer.example/oauth/callback";

let upstream: Upstream;
let provider: ReturnType<typeof mockOAuthProvider>;
beforeEach(() => {
  provider = mockOAuthProvider();
  upstream = installUpstream({ "github.com": provider.handler });
});
afterEach(() => {
  upstream.restore();
  vi.useRealTimers();
});

async function begin(tenantId: string, label = "main") {
  const r = await oauthM.oauthBegin(
    makeVault(),
    { tenantId, dest: "github", label, redirectUri: REDIRECT, scopes: ["repo", "read:org"] },
    META,
  );
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("begin failed");
  return new URL(r.value.authorizeUrl);
}

describe("oauthBegin", () => {
  test("builds the provider authorize URL with client id, redirect, scopes, state", async () => {
    const url = await begin(uniqueTenant());
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-github-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("repo read:org");
    expect(url.searchParams.get("state")).toMatch(/^v1\./);
  });

  test("non-OAuth destinations refuse the flow", async () => {
    const r = await oauthM.oauthBegin(
      makeVault(),
      { tenantId: uniqueTenant(), dest: "vercel", label: "x", redirectUri: REDIRECT },
      META,
    );
    expect(!r.ok && r.error).toBe("oauth_not_supported");
  });
});

describe("oauthCallback", () => {
  test("exchanges the code and stores a spendable grant", async () => {
    const tenantId = uniqueTenant();
    const state = (await begin(tenantId)).searchParams.get("state")!;
    const r = await oauthM.oauthCallback(makeVault(), { code: "auth-code-1", state }, META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ dest: "github", label: "main", kind: "oauth", health: "ok" });
    expect(provider.state.exchanges).toBe(1);
    // The exchange carried the code, redirect_uri, and client credentials.
    const exchange = upstream.to("github.com").find((q) => q.body.includes("authorization_code"));
    expect(exchange).toBeDefined();
    const params = new URLSearchParams(exchange!.body);
    expect(params.get("code")).toBe("auth-code-1");
    expect(params.get("redirect_uri")).toBe(REDIRECT);
    expect(params.get("client_secret")).toBe("test-github-client-secret");
    // Spendable: getToken returns the exchanged access token.
    const tok = await spendM.getToken(makeVault(), { tenantId, dest: "github" }, META);
    expect(tok.ok && tok.value.token).toBe("exchanged-token-1");
  });

  test("state is single-use: replay → state_invalid, no second exchange", async () => {
    const tenantId = uniqueTenant();
    const state = (await begin(tenantId)).searchParams.get("state")!;
    const first = await oauthM.oauthCallback(makeVault(), { code: "c", state }, META);
    expect(first.ok).toBe(true);
    const replay = await oauthM.oauthCallback(makeVault(), { code: "c", state }, META);
    expect(!replay.ok && replay.error).toBe("state_invalid");
    expect(provider.state.exchanges).toBe(1);
  });

  test("tampered state → state_invalid, zero exchanges", async () => {
    const tenantId = uniqueTenant();
    const state = (await begin(tenantId)).searchParams.get("state")!;
    const [v, body, mac] = state.split(".");
    const tampered = `${v}.${body!.slice(0, -2)}AA.${mac}`;
    const r = await oauthM.oauthCallback(makeVault(), { code: "c", state: tampered }, META);
    expect(!r.ok && r.error).toBe("state_invalid");
    expect(provider.state.exchanges).toBe(0);
  });

  test("state expires after its 10-minute TTL", async () => {
    const tenantId = uniqueTenant();
    const state = (await begin(tenantId)).searchParams.get("state")!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const r = await oauthM.oauthCallback(makeVault(), { code: "c", state }, META);
    expect(!r.ok && r.error).toBe("state_invalid");
    expect(provider.state.exchanges).toBe(0);
  });

  test("state bound to another tenant is rejected there", async () => {
    const tenantA = uniqueTenant("a");
    const tenantB = uniqueTenant("b");
    const state = (await begin(tenantA)).searchParams.get("state")!;
    // Explicit tenantId overrides the state's routing hint — the HMAC-covered
    // tenant binding must still win.
    const r = await oauthM.oauthCallback(
      makeVault(),
      { tenantId: tenantB, code: "c", state },
      META,
    );
    expect(!r.ok && r.error).toBe("state_invalid");
    expect(provider.state.exchanges).toBe(0);
    // And tenant B holds no github grant.
    const listed = await grantsM.list(makeVault(), { tenantId: tenantB }, META);
    expect(listed.ok && listed.value).toEqual([]);
  });
});
