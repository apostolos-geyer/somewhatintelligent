import { SELF, env } from "cloudflare:test";

// Exercises the real-world shape this feature exists for: ONE host running
// `/api` passthrough + `/account` vmf + `/` redirect together (mirrors
// workers/bouncer/wrangler.jsonc's staging/production ROUTES). The
// mode-consistency rule in routes.ts is per-(host, mount) now, so this must
// boot cleanly — a regression here would mean the rule regressed back to
// per-host and broke the real config.
//
// APP1 → worker-a-stub (rich HTML fixture: asset links, favicon, script —
// see template-parity.test.ts for the same fixture exercised standalone).
// WWW → www-stub (has an /api/json branch, reused here as the "passthrough
// API" upstream).
beforeEach(() => {
  env.ROUTES = {
    routes: [
      { binding: "WWW", host: "platform.test", path: "/api", mode: "passthrough" },
      { binding: "APP1", host: "platform.test", path: "/account", mode: "vmf" },
      { host: "platform.test", path: "/", mode: "redirect", to: "/shop" },
    ],
  } as unknown as Env["ROUTES"];
});

describe("passthrough + vmf + redirect coexisting on one host", () => {
  test("/api dispatches passthrough — unmodified upstream response, no mount stripping", async () => {
    const res = await SELF.fetch("https://platform.test/api/json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });

  test("/account dispatches vmf — mount prefix stripped before reaching upstream", async () => {
    const res = await SELF.fetch("https://platform.test/account/sign-in");
    expect(res.status).toBe(200);
    const html = await res.text();
    // worker-a-stub echoes the path IT received — proves bouncer stripped
    // "/account" before forwarding (upstream sees "/sign-in", not
    // "/account/sign-in").
    expect(html).toContain("Path: /sign-in");
  });

  test("/account response has its asset paths rewritten under the mount", async () => {
    const res = await SELF.fetch("https://platform.test/account");
    const html = await res.text();
    expect(html).toContain('href="/account/assets/style.css"');
    expect(html).toContain('src="/account/assets/logo.png"');
    expect(html).toContain('src="/account/static/app.js"');
    // Favicon is rewritten even though it isn't in the default asset-prefix
    // list (AllAttributesRewriter special-cases icon/shortcut rel links).
    expect(html).toContain('href="/account/favicon.ico"');
  });

  test("`/` redirects — and is not shadowed by /api or /account (specificity)", async () => {
    const res = await SELF.fetch("https://platform.test/", { redirect: "manual" });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/shop");
  });

  test("an unmatched path under the host still falls through to the `/` redirect, not /account or /api", async () => {
    const res = await SELF.fetch("https://platform.test/anything-unmapped", {
      redirect: "manual",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/shop");
  });

  test("/api is not shadowed by the `/` redirect (longer mount wins)", async () => {
    const res = await SELF.fetch("https://platform.test/api/json", { redirect: "manual" });
    expect(res.status).toBe(200);
  });

  test("/account is not shadowed by the `/` redirect (longer mount wins)", async () => {
    const res = await SELF.fetch("https://platform.test/account/sign-in", { redirect: "manual" });
    expect(res.status).toBe(200);
  });
});
