import { describe, expect, test } from "vitest";
import { normalizeBasepath, resolveBasepath } from "@/lib/basepath";

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
