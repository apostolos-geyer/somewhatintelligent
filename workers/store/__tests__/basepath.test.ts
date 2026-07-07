import { describe, expect, test } from "vitest";
import { mountRewrite, normalizeBasepath, resolveBasepath } from "@/lib/basepath";

describe("normalizeBasepath", () => {
  test("empty / null / undefined → '/'", () => {
    expect(normalizeBasepath(undefined)).toBe("/");
    expect(normalizeBasepath(null)).toBe("/");
    expect(normalizeBasepath("")).toBe("/");
    expect(normalizeBasepath("   ")).toBe("/");
    expect(normalizeBasepath("/")).toBe("/");
  });

  test("adds a leading slash and strips trailing slashes", () => {
    expect(normalizeBasepath("shop")).toBe("/shop");
    expect(normalizeBasepath("/shop")).toBe("/shop");
    expect(normalizeBasepath("/shop/")).toBe("/shop");
    expect(normalizeBasepath("shop///")).toBe("/shop");
    expect(normalizeBasepath("/account")).toBe("/account");
  });
});

describe("resolveBasepath", () => {
  test("server is always root (bouncer's vmf already stripped the mount)", () => {
    // Even under the mount, the server sees the stripped path — basepath must
    // be '/' server-side or matching fails.
    expect(resolveBasepath({ isServer: true, publicBase: "/shop" })).toBe("/");
    expect(resolveBasepath({ isServer: true, publicBase: "/shop/" })).toBe("/");
    expect(resolveBasepath({ isServer: true, publicBase: undefined })).toBe("/");
  });

  test("client adopts the public mount so the URL bar keeps the prefix", () => {
    expect(resolveBasepath({ isServer: false, publicBase: "/shop" })).toBe("/shop");
    expect(resolveBasepath({ isServer: false, publicBase: "/shop/" })).toBe("/shop");
    expect(resolveBasepath({ isServer: false, publicBase: "/account" })).toBe("/account");
  });

  test("client with no configured base (local dev-direct) → '/'", () => {
    expect(resolveBasepath({ isServer: false, publicBase: undefined })).toBe("/");
    expect(resolveBasepath({ isServer: false, publicBase: "/" })).toBe("/");
  });
});

describe("resolveBasepath — runtime si-mount meta", () => {
  test("client: mount meta wins over PUBLIC_BASE", () => {
    expect(resolveBasepath({ isServer: false, publicBase: "/shop", mountMeta: "/other" })).toBe(
      "/other",
    );
  });
  test("client: falls back to PUBLIC_BASE when no meta", () => {
    expect(resolveBasepath({ isServer: false, publicBase: "/shop", mountMeta: null })).toBe(
      "/shop",
    );
    expect(resolveBasepath({ isServer: false, publicBase: "/shop", mountMeta: "  " })).toBe(
      "/shop",
    );
  });
  test("server: meta never applies — bouncer already stripped the mount", () => {
    expect(resolveBasepath({ isServer: true, publicBase: "/shop", mountMeta: "/shop" })).toBe("/");
  });
  test("meta is normalized like any base", () => {
    expect(resolveBasepath({ isServer: false, publicBase: null, mountMeta: "shop/" })).toBe(
      "/shop",
    );
  });
});

describe("mountRewrite", () => {
  // The mount rides the router `rewrite` option, not `basepath`: TanStack
  // Start's server handler AND client bootstrap both call
  // router.update({ basepath: process.env.TSS_ROUTER_BASEPATH }), clobbering
  // any createRouter-level basepath — the regression that unmounted the
  // whole tree on staging the moment hydration finished. `rewrite` survives
  // those updates, so these tests pin the strip/prepend contract.
  const url = (path: string) => new URL(`https://example.com${path}`);

  test("root mount → no rewrite at all (dev-direct, server)", () => {
    expect(mountRewrite("/")).toBeUndefined();
    expect(mountRewrite("")).toBeUndefined();
    expect(mountRewrite("  ")).toBeUndefined();
  });

  test("input strips the mount (browser URL → router URL)", () => {
    const rw = mountRewrite("/shop");
    expect(rw).toBeDefined();
    expect(rw?.input({ url: url("/shop") }).pathname).toBe("/");
    expect(rw?.input({ url: url("/shop/") }).pathname).toBe("/");
    expect(rw?.input({ url: url("/shop/products/tee") }).pathname).toBe("/products/tee");
  });

  test("input leaves non-mount paths alone", () => {
    const rw = mountRewrite("/shop");
    expect(rw?.input({ url: url("/shopping") }).pathname).toBe("/shopping");
    expect(rw?.input({ url: url("/other") }).pathname).toBe("/other");
  });

  test("output prepends the mount (router URL → browser URL)", () => {
    const rw = mountRewrite("/shop");
    expect(rw?.output({ url: url("/") }).pathname).toBe("/shop");
    expect(rw?.output({ url: url("/products/tee") }).pathname).toBe("/shop/products/tee");
  });

  test("input and output round-trip", () => {
    const rw = mountRewrite("/shop");
    for (const p of ["/", "/cart", "/products/tee"]) {
      const out = rw?.output({ url: url(p) });
      expect(rw?.input({ url: out as URL }).pathname).toBe(p);
    }
  });

  test("mount is normalized before use", () => {
    const rw = mountRewrite("shop/");
    expect(rw?.input({ url: url("/shop/cart") }).pathname).toBe("/cart");
    expect(rw?.output({ url: url("/cart") }).pathname).toBe("/shop/cart");
  });
});
