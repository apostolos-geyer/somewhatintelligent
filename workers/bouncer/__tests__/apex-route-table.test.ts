import { SELF, env } from "cloudflare:test";
import { compileRoutes, matchRoute } from "@somewhatintelligent/bouncer";
import { LOCAL_BNC_ATT_PRIV } from "../../../scripts/dev-config";

// RFC-0001 D12 target route table (the RFC's "Bouncer routing tests"): Site
// owns the apex root as a passthrough catch-all, Identity stays vmf-mounted
// at /account, Store is headless behind /api/store + /hooks/store, and
// guestlist keeps /api. Mirrors workers/bouncer/wrangler.jsonc's staging and
// production shape. Bindings resolve to the miniflare stub workers declared
// in vite.config.ts: GUESTLIST → guestlist-stub (JSON), IDENTITY → app-stub
// (path echo + root-relative assets), STORE → store-stub (path echo),
// SITE → site-stub (path echo + root-relative assets).
const ROUTE_TABLE = {
  routes: [
    { binding: "STORE", host: "platform.test", path: "/api/store", mode: "passthrough" },
    { binding: "STORE", host: "platform.test", path: "/hooks/store", mode: "passthrough" },
    { binding: "GUESTLIST", host: "platform.test", path: "/api", mode: "passthrough" },
    { binding: "IDENTITY", host: "platform.test", path: "/account", mode: "vmf" },
    { binding: "IDENTITY", host: "platform.test", path: "/_sfn/account", mode: "passthrough" },
    { binding: "IDENTITY", host: "platform.test", path: "/_assets/account", mode: "passthrough" },
    { binding: "SITE", host: "platform.test", path: "/", mode: "passthrough" },
  ],
};

beforeEach(() => {
  env.BNC_ATT_PRIV = LOCAL_BNC_ATT_PRIV;
  env.ROUTES = ROUTE_TABLE as unknown as Env["ROUTES"];
});

describe("RFC D12 apex route table (stub-tested, pre-cutover)", () => {
  test("/writing/example reaches Site with the path unchanged (passthrough: no strip, no rewrite)", async () => {
    const res = await SELF.fetch("https://platform.test/writing/example");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Site stub");
    // site-stub echoes the path IT received — passthrough forwarded
    // /writing/example untouched, no mount strip.
    expect(html).toContain("<p>Path: /writing/example</p>");
  });

  test("/account/security reaches Identity as /security (vmf strip)", async () => {
    const res = await SELF.fetch("https://platform.test/account/security");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("app stub: /security");
  });

  test("Identity HTML receives /account asset rewrites and the si-mount meta", async () => {
    const res = await SELF.fetch("https://platform.test/account");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<meta name="si-mount" content="/account">');
    expect(html).toContain('href="/account/assets/app.css"');
    expect(html).toContain('href="/account/favicon.ico"');
    expect(html).toContain('src="/account/static/app.js"');
  });

  test("Site HTML receives no vmf mount metadata and no asset rewriting", async () => {
    const res = await SELF.fetch("https://platform.test/writing/example");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("si-mount");
    // Root-relative asset URLs survive verbatim — the vmf rewrite pipeline
    // never ran on this response.
    expect(html).toContain('href="/assets/site.css"');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('src="/_astro/client.js"');
  });

  test.each([
    // vmf strip to the app root.
    ["/account", "app stub: /"],
    // Passthrough support mounts arrive unstripped.
    ["/_sfn/account", "app stub: /_sfn/account"],
    ["/_assets/account/chunk-1a2b.js", "app stub: /_assets/account/chunk-1a2b.js"],
    ["/api/store/checkout-sessions", "store stub: /api/store/checkout-sessions"],
    ["/hooks/store/stripe", "store stub: /hooks/store/stripe"],
  ])("%s dispatches to its own mount, not the Site root catch-all", async (path, echo) => {
    const res = await SELF.fetch(`https://platform.test${path}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(echo);
    expect(body).not.toContain("Site stub");
  });

  test("/api/store/x goes to STORE, not GUESTLIST (longest prefix beats /api)", async () => {
    const res = await SELF.fetch("https://platform.test/api/store/checkout-sessions", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("store stub: /api/store/checkout-sessions");
  });

  test("other /api paths still reach GUESTLIST", async () => {
    const res = await SELF.fetch("https://platform.test/api/auth/get-session");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    // guestlist-stub's plain-request branch — proof the request did NOT fall
    // to the STORE mount.
    expect(await res.json()).toEqual({ data: null });
  });

  test("/hooks/store/stripe goes to STORE (webhook ingress stays Store-owned)", async () => {
    const res = await SELF.fetch("https://platform.test/hooks/store/stripe", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("store stub: /hooks/store/stripe");
  });

  test("/ and the demounted /shop now belong to Site (no redirect, no strip)", async () => {
    const root = await SELF.fetch("https://platform.test/", { redirect: "manual" });
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("<p>Path: /</p>");

    const shop = await SELF.fetch("https://platform.test/shop", { redirect: "manual" });
    expect(shop.status).toBe(200);
    const html = await shop.text();
    expect(html).toContain("Site stub");
    expect(html).toContain("<p>Path: /shop</p>");
  });
});

describe("compileRoutes + matchRoute: the RFC D12 table", () => {
  test("compiles with Site passthrough at the root and no redirect routes", () => {
    const { routes } = compileRoutes(ROUTE_TABLE);
    const root = routes.find((r) => r.staticMount === "/");
    expect(root?.mode).toBe("passthrough");
    expect(root?.bindingName).toBe("SITE");
    // The redirect mode stays in the schema, but this table uses none of it.
    expect(routes.some((r) => r.mode === "redirect")).toBe(false);
  });

  test("longest mount wins at the matcher level", () => {
    const { routes } = compileRoutes(ROUTE_TABLE);
    const owner = (path: string) => matchRoute(routes, "platform.test", path)?.route.bindingName;
    expect(owner("/api/store/checkout-sessions")).toBe("STORE");
    expect(owner("/api/store")).toBe("STORE");
    expect(owner("/api/auth/get-session")).toBe("GUESTLIST");
    expect(owner("/hooks/store/stripe")).toBe("STORE");
    expect(owner("/account")).toBe("IDENTITY");
    expect(owner("/account/security")).toBe("IDENTITY");
    expect(owner("/_sfn/account")).toBe("IDENTITY");
    expect(owner("/_assets/account/chunk.js")).toBe("IDENTITY");
    expect(owner("/writing/example")).toBe("SITE");
    expect(owner("/")).toBe("SITE");
    expect(owner("/shop")).toBe("SITE");
  });

  test("mode is selected per mount: /account vmf, Site root passthrough", () => {
    const { routes } = compileRoutes(ROUTE_TABLE);
    expect(matchRoute(routes, "platform.test", "/account")?.route.mode).toBe("vmf");
    expect(matchRoute(routes, "platform.test", "/writing/example")?.route.mode).toBe("passthrough");
  });
});
