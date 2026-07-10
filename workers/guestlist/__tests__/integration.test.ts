/**
 * Proves the packaged guestlist actually works in workerd: better-auth
 * serves over HTTP, the WorkerEntrypoint RPC surface authenticates via
 * cookies, and disabled features are absent rather than broken.
 */
import { SELF, env } from "cloudflare:test";

const ORIGIN = "https://guestlist.somewhatintelligent.ca";

async function signUp(email: string, name = "Ref User") {
  const res = await SELF.fetch(`${ORIGIN}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct-horse-battery", name }),
  });
  expect(res.status).toBe(200);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  expect(cookie).toContain("si.session_token");
  return cookie;
}

describe("HTTP surface (better-auth only)", () => {
  test("/health answers", async () => {
    const res = await SELF.fetch(`${ORIGIN}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", service: "guestlist" });
  });

  test("sign-up + get-session round-trips through the BA handler", async () => {
    const cookie = await signUp("http@ref.test");
    const res = await SELF.fetch(`${ORIGIN}/api/auth/get-session`, {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string } };
    expect(body.user.email).toBe("http@ref.test");
  });

  test("former Elysia API routes do not exist over HTTP", async () => {
    for (const path of ["/admin/stats", "/api/users/search", "/user/connections", "/providers"]) {
      const res = await SELF.fetch(`${ORIGIN}${path}`, { method: "GET" });
      expect(res.status, path).toBe(404);
    }
  });

  test("avatar read 404s for an unknown reference", async () => {
    // Blobs ARE configured (roadie), but the test roadie stub resolves no
    // read URL, so an unknown ref still 302-less 404s.
    const res = await SELF.fetch(`${ORIGIN}/u/avatar/someref12345`);
    expect(res.status).toBe(404);
  });
});

describe("WorkerEntrypoint RPC surface", () => {
  test("getSession resolves a session from the cookie", async () => {
    const cookie = await signUp("rpc@ref.test");
    const { session } = await env.GL_RPC.getSession({ cookie });
    expect(session?.user.email).toBe("rpc@ref.test");
  });

  test("getSession is anonymous for garbage cookies", async () => {
    const { session, setCookies } = await env.GL_RPC.getSession({
      cookie: "si.session_token=not-a-real-token",
    });
    expect(session).toBeNull();
    expect(setCookies).toEqual([]);
  });

  test("session-gated methods reject without a valid cookie", async () => {
    const res = await env.GL_RPC.searchUsers({ cookie: "", query: "ref" });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });

  test("directory search works for an authenticated user", async () => {
    const cookie = await signUp("finder@ref.test", "Findable Fred");
    const res = await env.GL_RPC.searchUsers({ cookie, query: "findable" });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.map((u) => u.email)).toContain("finder@ref.test");
  });

  test("admin methods 'forbidden' for a plain user, not a crash", async () => {
    const cookie = await signUp("pleb@ref.test");
    const res = await env.GL_RPC.adminListOrgs({ cookie });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });

  test("avatar register reaches the configured blob store (roadie)", async () => {
    // si wires blobs to roadie, so registerAvatarUpload passes validation
    // and calls the store — it must NOT report the capability disabled. The
    // test roadie stub returns a not-ok result, which surfaces as a store
    // error, proving the adapter was invoked rather than short-circuited.
    const cookie = await signUp("avatar@si.test");
    const res = await env.GL_RPC.registerAvatarUpload({
      cookie,
      hash: "a".repeat(64),
      size: 1024,
      contentType: "image/png",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).not.toBe("avatars_disabled");
  });

  test("getProviders reflects unconfigured social providers", async () => {
    const res = await env.GL_RPC.getProviders();
    expect(res.social).toEqual({
      google: false,
      microsoft: false,
      facebook: false,
      linkedin: false,
    });
  });
});
