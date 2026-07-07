import { SELF, env } from "cloudflare:test";
import { compileRoutes } from "../src/routes";

// The store (`/shop`) is vmf-mounted exactly like identity (`/account`):
// bouncer strips the mount inbound so the app serves at its own root, and
// rewrites the outbound artifacts (asset paths, favicon) back under the mount.
// This mirrors workers/bouncer/wrangler.jsonc's staging/production shape —
// `/api` passthrough + `/account` + `/shop` vmf + `/` redirect on one host.
// The app then closes the client-side-navigation gap itself with a client-only
// router basepath (see workers/store/src/lib/basepath.ts); that is app-side and
// not observable from bouncer, so here we assert only the vmf HTTP contract for
// the `/shop` mount. APP1 → worker-a-stub (echoes received path + emits
// root-relative asset URLs).
beforeEach(() => {
  env.ROUTES = {
    routes: [
      { binding: "WWW", host: "platform.test", path: "/api", mode: "passthrough" },
      { binding: "APP2", host: "platform.test", path: "/account", mode: "vmf" },
      { binding: "APP1", host: "platform.test", path: "/shop", mode: "vmf" },
      { host: "platform.test", path: "/", mode: "redirect", to: "/shop" },
    ],
  } as unknown as Env["ROUTES"];
});

describe("store /shop vmf mount", () => {
  test("mount prefix is stripped before reaching the store — app serves at root", async () => {
    const res = await SELF.fetch("https://platform.test/shop/products/tee");
    expect(res.status).toBe(200);
    // worker-a-stub echoes the path IT received: bouncer stripped `/shop`, so
    // the store's server code sees `/products/tee` (prefix-free, at root).
    expect(await res.text()).toContain("Path: /products/tee");
  });

  test("store response assets are rewritten under the /shop mount", async () => {
    const res = await SELF.fetch("https://platform.test/shop");
    const html = await res.text();
    expect(html).toContain('href="/shop/assets/style.css"');
    expect(html).toContain('src="/shop/assets/logo.png"');
    expect(html).toContain('src="/shop/static/app.js"');
    expect(html).toContain('href="/shop/favicon.ico"');
  });

  test("a deep link under /shop is not shadowed by the `/` redirect (longer mount wins)", async () => {
    const res = await SELF.fetch("https://platform.test/shop/orders/AT-7Q2K9", {
      redirect: "manual",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Path: /orders/AT-7Q2K9");
  });

  test("/shop and /account (both vmf) coexist with /api passthrough on one host", async () => {
    const shop = await SELF.fetch("https://platform.test/shop");
    const account = await SELF.fetch("https://platform.test/account");
    const api = await SELF.fetch("https://platform.test/api/json");
    expect(shop.status).toBe(200);
    expect(account.status).toBe(200);
    expect(api.status).toBe(200);
  });
});

describe("compileRoutes: the staging-shaped store route table", () => {
  test("compiles cleanly — /api passthrough + /account + /shop vmf + / redirect", () => {
    const { routes } = compileRoutes({
      routes: [
        { binding: "GUESTLIST", host: "h.test", path: "/api", mode: "passthrough" },
        { binding: "IDENTITY", host: "h.test", path: "/account", mode: "vmf" },
        { binding: "STORE", host: "h.test", path: "/shop", mode: "vmf" },
        { host: "h.test", path: "/", mode: "redirect", to: "/shop", status: 308 },
      ],
    });
    const shop = routes.find((r) => r.staticMount === "/shop");
    expect(shop?.mode).toBe("vmf");
    expect(shop?.bindingName).toBe("STORE");
  });
});
