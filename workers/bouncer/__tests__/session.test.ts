import { env } from "cloudflare:test";
import {
  createBouncerSessionResolver,
  mergeCookiesIntoRequest,
} from "@somewhatintelligent/bouncer";
import { withRequestContext } from "@somewhatintelligent/kit/request-context";
import { platformConfig } from "@si/config";

const prefix = platformConfig.cookies.prefix;
// Wire cookie names: `<prefix>.session_token`, `<prefix>.session_data`. The
// session_* suffixes are better-auth's own names; only the prefix is config-derived.
const SESSION_TOKEN_COOKIE = `${prefix}.session_token`;
const SESSION_DATA_COOKIE = `${prefix}.session_data`;
const sessionDataRe = new RegExp(`(__Secure-)?${prefix}\\.session_data=NEW_VALUE`);
const sessionTokenRe = new RegExp(`(__Secure-)?${prefix}\\.session_token=ORIG`);
const otherRe = /other=keepme/;

const opts = { cookiePrefix: prefix };

describe("createBouncerSessionResolver (over the guestlist RPC binding)", () => {
  test("no cookie → no guestlist call, null session, empty setCookies", async () => {
    const resolve = createBouncerSessionResolver(env, opts);
    const req = new Request("https://platform.test/");
    const res = await withRequestContext({ requestId: "test" }, () => resolve(req));
    expect(res.session).toBeNull();
    expect(res.setCookies).toEqual([]);
  });

  test("stale cookie → guestlist returns session + Set-Cookie captured", async () => {
    const resolve = createBouncerSessionResolver(env, opts);
    const req = new Request("https://platform.test/", {
      headers: { cookie: `${SESSION_TOKEN_COOKIE}=STALE` },
    });
    const res = await withRequestContext({ requestId: "test" }, () => resolve(req));
    expect((res.session as { user: { id: string } } | null)?.user.id).toBe("u_42");
    expect(res.setCookies.length).toBeGreaterThan(0);
    expect(res.setCookies[0]).toMatch(sessionDataRe);
  });

  test("guestlist throws → fail open with null session, empty setCookies", async () => {
    const resolve = createBouncerSessionResolver(env, opts);
    const req = new Request("https://platform.test/", {
      headers: { cookie: `${SESSION_TOKEN_COOKIE}=THROW` },
    });
    const res = await withRequestContext({ requestId: "test" }, () => resolve(req));
    expect(res.session).toBeNull();
    expect(res.setCookies).toEqual([]);
  });
});

describe("mergeCookiesIntoRequest", () => {
  test("no setCookies → returns original request", () => {
    const req = new Request("https://platform.test/", {
      headers: { cookie: `${SESSION_TOKEN_COOKIE}=ORIG` },
    });
    const out = mergeCookiesIntoRequest(req, []);
    expect(out).toBe(req);
  });

  test("setCookies merge into forwarded Cookie header", () => {
    const req = new Request("https://platform.test/", {
      headers: { cookie: `${SESSION_TOKEN_COOKIE}=ORIG; other=keepme` },
    });
    const out = mergeCookiesIntoRequest(req, [
      `${SESSION_DATA_COOKIE}=NEW_VALUE; Path=/; HttpOnly`,
    ]);
    expect(out).not.toBe(req);
    const cookie = out.headers.get("cookie") ?? "";
    expect(cookie).toMatch(sessionDataRe);
    expect(cookie).toMatch(sessionTokenRe);
    expect(cookie).toMatch(otherRe);
  });
});
