import { SELF, env } from "cloudflare:test";

// One fixed ROUTES config for the whole file (mirrors proxy.test.ts /
// template-parity.test.ts — this suite doesn't vary ROUTES per test, so
// there's no risk of the per-isolate `loadConfig` cache in src/index.ts
// serving a stale compile from an earlier test).
//
// `platform.test` mixes redirect + passthrough on the SAME host (the
// coexistence this feature exists to allow); `legacy.test` exercises a
// redirect-only host.
beforeEach(() => {
  env.ROUTES = {
    routes: [
      { binding: "WWW", host: "platform.test", path: "/api", mode: "passthrough" },
      { host: "platform.test", path: "/", mode: "redirect", to: "/shop" },
      {
        host: "legacy.test",
        path: "/",
        mode: "redirect",
        to: "https://elsewhere.test/new",
        status: 301,
      },
    ],
  } as unknown as Env["ROUTES"];
});

describe("redirect dispatch", () => {
  test("root redirect answers directly with the configured status + Location", async () => {
    const res = await SELF.fetch("https://platform.test/", { redirect: "manual" });
    expect(res.status).toBe(308); // default status when unspecified
    expect(res.headers.get("location")).toBe("/shop");
  });

  test("redirect status is configurable", async () => {
    const res = await SELF.fetch("https://legacy.test/", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://elsewhere.test/new");
  });

  test("a redirect route never reaches an upstream fetcher (no binding required)", async () => {
    // If dispatch tried to resolve a binding for the redirect route, this
    // would throw ("route binding ... is not a bound Fetcher") instead of
    // returning a clean redirect.
    const res = await SELF.fetch("https://platform.test/anything-under-root", {
      redirect: "manual",
    });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/shop");
  });

  test("a longer passthrough mount (/api) is not shadowed by the `/` redirect on the same host", async () => {
    const res = await SELF.fetch("https://platform.test/api/json");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
  });
});
