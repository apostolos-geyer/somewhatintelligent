import { compileRoutes, matchRoute } from "../src/routes";
import { platformDeployConfig } from "@greenroom/config";

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

  test("rejects mixing passthrough and vmf for the same host", () => {
    expect(() =>
      compileRoutes({
        routes: [
          { binding: "A", host: "files.test", path: "/transfers", mode: "vmf" },
          { binding: "B", host: "files.test", path: "/raw", mode: "passthrough" },
        ],
      }),
    ).toThrow(/host "files\.test" has routes in both/);
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
