import { compileRoutes, matchRoute } from "../src/routes";
import { platformDeployConfig } from "@si/config";

// Base domain is config-derived so a rebrand never leaves these matcher
// fixtures stale. e.g. baseDomain="platform.example" → wildcard "*.platform.example",
// exact "platform.example", "www.platform.example", and the too-deep
// "a.b.platform.example" rejection case.
const baseDomain = platformDeployConfig.baseDomain;
const wildcardHost = `*.${baseDomain}`;
const wwwHost = `www.${baseDomain}`;
const appHost = `app.${baseDomain}`;
const unlistedHost = `unlisted.${baseDomain}`;
const tooDeepHost = `a.b.${baseDomain}`;

describe("compileRoutes", () => {
  test("requires binding and path; host is optional", () => {
    expect(() => compileRoutes({ routes: [{ binding: "WWW" }] })).toThrow();
    expect(() => compileRoutes({ routes: [{ host: "x", path: "/" }] })).toThrow();
    expect(() => compileRoutes({ routes: [{ binding: "WWW", path: "/" }] })).not.toThrow();
  });

  test("throws on unclosed path expression group", () => {
    expect(() =>
      compileRoutes({
        routes: [{ binding: "X", host: "a", path: "/:id(open" }],
      }),
    ).toThrow(/Unclosed/);
  });

  test("throws on non-array routes", () => {
    expect(() => compileRoutes({ routes: "nope" })).toThrow();
    expect(() => compileRoutes(null)).toThrow();
  });

  test("mode defaults to passthrough when omitted", () => {
    const { routes } = compileRoutes({
      routes: [{ binding: "WWW", host: "a.test", path: "/" }],
    });
    expect(routes[0]!.mode).toBe("passthrough");
  });

  test("mode is preserved when explicit", () => {
    const { routes } = compileRoutes({
      routes: [
        { binding: "WWW", host: "a.test", path: "/", mode: "vmf" },
        { binding: "X", host: "x.test", path: "/", mode: "passthrough" },
      ],
    });
    const byBinding = Object.fromEntries(routes.map((r) => [r.bindingName, r.mode]));
    expect(byBinding).toEqual({ WWW: "vmf", X: "passthrough" });
  });

  test("rejects unknown mode values at parse", () => {
    expect(() =>
      compileRoutes({
        routes: [{ binding: "WWW", host: "a.test", path: "/", mode: "edge" }],
      }),
    ).toThrow(/ROUTES validation failed/);
  });

  test("rejects mixing passthrough and vmf for the SAME mount on one host", () => {
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "A", host: "files.test", path: "/transfers", mode: "vmf" },
          { binding: "B", host: "files.test", path: "/transfers", mode: "passthrough" },
        ],
      }),
    ).toThrow(/host "files\.test" mount "\/transfers" has routes in both/);
  });

  test("allows mixing passthrough and vmf on ONE host as long as their mounts differ", () => {
    // The mode-consistency rule is per-(host, mount) now, not per-host: a
    // vmf-mounted app and a passthrough API can share an apex (e.g. `/account`
    // vmf + `/api` passthrough) — dispatch already picks mode per matched
    // route, so there's no cross-mount conflict for handleMountedApp to worry
    // about.
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "A", host: "files.test", path: "/transfers", mode: "vmf" },
          { binding: "B", host: "files.test", path: "/raw", mode: "passthrough" },
        ],
      }),
    ).not.toThrow();
  });

  test("multiple vmf routes on the same host parse cleanly", () => {
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "A", host: "files.test", path: "/transfers", mode: "vmf" },
          { binding: "B", host: "files.test", path: "/drive", mode: "vmf" },
        ],
      }),
    ).not.toThrow();
  });
});

describe("matchRoute", () => {
  const { routes } = compileRoutes({
    routes: [
      { binding: "WWW", host: baseDomain, path: "/" },
      { binding: "APP", host: appHost, path: "/" },
      { binding: "ANY", host: wildcardHost, path: "/" },
    ],
  });

  test("exact host + path / matches the configured binding", () => {
    const m = matchRoute(routes, baseDomain, "/");
    expect(m?.route.bindingName).toBe("WWW");
    expect(m?.mountActual).toBe("/");
  });

  test("wildcard *.<baseDomain> matches an unlisted subdomain", () => {
    const m = matchRoute(routes, unlistedHost, "/");
    expect(m?.route.bindingName).toBe("ANY");
  });

  test("exact host beats wildcard for the same subdomain", () => {
    const m = matchRoute(routes, appHost, "/");
    expect(m?.route.bindingName).toBe("APP");
  });

  test("longer path prefix beats shorter at same host", () => {
    const { routes: r2 } = compileRoutes({
      routes: [
        { binding: "ROOT", host: baseDomain, path: "/" },
        { binding: "DOCS", host: baseDomain, path: "/docs" },
      ],
    });
    expect(matchRoute(r2, baseDomain, "/docs/getting-started")?.route.bindingName).toBe("DOCS");
    expect(matchRoute(r2, baseDomain, "/about")?.route.bindingName).toBe("ROOT");
  });

  test("returns null for an unmatched host", () => {
    expect(matchRoute(routes, "example.com", "/")).toBeNull();
  });

  test("wildcard does not match nested subdomains (single label only)", () => {
    expect(matchRoute(routes, tooDeepHost, "/")).toBeNull();
  });

  test("path-only route (no host) is the verbatim template behavior", () => {
    const { routes: r3 } = compileRoutes({
      routes: [{ binding: "ANY", path: "/" }],
    });
    expect(matchRoute(r3, "anything.example.com", "/foo")?.route.bindingName).toBe("ANY");
  });

  test("host array expands into one matchable entry per host", () => {
    const { routes: rArr } = compileRoutes({
      routes: [{ binding: "WWW", host: [baseDomain, wwwHost], path: "/" }],
    });
    expect(matchRoute(rArr, baseDomain, "/")?.route.bindingName).toBe("WWW");
    expect(matchRoute(rArr, wwwHost, "/")?.route.bindingName).toBe("WWW");
    expect(matchRoute(rArr, "other.example.com", "/")).toBeNull();
  });

  test("host array entries respect specificity (exact beats wildcard)", () => {
    const { routes: rArr } = compileRoutes({
      routes: [
        { binding: "WILD", host: wildcardHost, path: "/" },
        { binding: "WWW", host: [baseDomain, wwwHost], path: "/" },
      ],
    });
    expect(matchRoute(rArr, wwwHost, "/")?.route.bindingName).toBe("WWW");
    expect(matchRoute(rArr, unlistedHost, "/")?.route.bindingName).toBe("WILD");
  });

  test("empty host array is treated as host-less (any host)", () => {
    const { routes: rArr } = compileRoutes({
      routes: [{ binding: "ANY", host: [], path: "/" }],
    });
    expect(matchRoute(rArr, "anything.example.com", "/")?.route.bindingName).toBe("ANY");
  });

  test("host-restricted route wins over a path-only fallback for the matched host", () => {
    const { routes: r4 } = compileRoutes({
      routes: [
        { binding: "FALLBACK", path: "/" },
        { binding: "PLATFORM", host: baseDomain, path: "/" },
      ],
    });
    expect(matchRoute(r4, baseDomain, "/")?.route.bindingName).toBe("PLATFORM");
    expect(matchRoute(r4, "other.com", "/")?.route.bindingName).toBe("FALLBACK");
  });
});

describe("redirect mode", () => {
  test("schema accepts a redirect route with no binding", () => {
    expect(() =>
      compileRoutes({
        routes: [{ host: baseDomain, path: "/", mode: "redirect", to: "/shop" }],
      }),
    ).not.toThrow();
  });

  test("status defaults to 308 when omitted, and is preserved when explicit", () => {
    const { routes: r1 } = compileRoutes({
      routes: [{ host: baseDomain, path: "/", mode: "redirect", to: "/shop" }],
    });
    expect(r1[0]!.redirectStatus).toBe(308);
    expect(r1[0]!.redirectTo).toBe("/shop");

    const { routes: r2 } = compileRoutes({
      routes: [{ host: baseDomain, path: "/", mode: "redirect", to: "/shop", status: 302 }],
    });
    expect(r2[0]!.redirectStatus).toBe(302);
  });

  test("rejects an unknown status code", () => {
    expect(() =>
      compileRoutes({
        routes: [{ host: baseDomain, path: "/", mode: "redirect", to: "/shop", status: 599 }],
      }),
    ).toThrow(/ROUTES validation failed/);
  });

  test("requires `to` for redirect routes", () => {
    expect(() =>
      compileRoutes({
        routes: [{ host: baseDomain, path: "/", mode: "redirect" }],
      }),
    ).toThrow();
  });

  test("coexists with a passthrough route on the same host (does not trip mode-consistency)", () => {
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "GUESTLIST", host: baseDomain, path: "/api", mode: "passthrough" },
          { host: baseDomain, path: "/", mode: "redirect", to: "/shop" },
        ],
      }),
    ).not.toThrow();
  });

  test("coexists with a vmf route on the same host", () => {
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "APP", host: baseDomain, path: "/app", mode: "vmf" },
          { host: baseDomain, path: "/legacy", mode: "redirect", to: "/app" },
        ],
      }),
    ).not.toThrow();
  });

  test("a longer static mount (e.g. /api) is not shadowed by a `/` redirect on the same host", () => {
    const { routes } = compileRoutes({
      routes: [
        { binding: "GUESTLIST", host: baseDomain, path: "/api", mode: "passthrough" },
        { host: baseDomain, path: "/", mode: "redirect", to: "/shop" },
      ],
    });
    const apiMatch = matchRoute(routes, baseDomain, "/api/whoami");
    expect(apiMatch?.route.mode).toBe("passthrough");
    expect(apiMatch?.route.bindingName).toBe("GUESTLIST");

    const rootMatch = matchRoute(routes, baseDomain, "/");
    expect(rootMatch?.route.mode).toBe("redirect");
    expect(rootMatch?.route.redirectTo).toBe("/shop");

    const otherMatch = matchRoute(routes, baseDomain, "/anything-else");
    expect(otherMatch?.route.mode).toBe("redirect");
  });
});
