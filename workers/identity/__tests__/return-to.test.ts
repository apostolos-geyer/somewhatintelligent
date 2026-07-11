/**
 * Open-redirect guard for post-auth `returnTo` targets. Exercises the env-free
 * core (`resolveReturnTo` / `isPlatformHost`) against the controlled apex so the
 * cross-subdomain trust rule is pinned in every environment shape.
 */
import { describe, expect, test } from "vitest";
import { isPlatformHost, resolveReturnTo } from "@/lib/return-to";

const PROD = ".platform.example.com";
const DEV = ".platform.example.localhost";

describe("isPlatformHost", () => {
  test("matches the bare apex", () => {
    expect(isPlatformHost("platform.example.com", PROD)).toBe(true);
  });

  test("matches single- and multi-label subdomains (brand portals)", () => {
    expect(isPlatformHost("identity.platform.example.com", PROD)).toBe(true);
    expect(isPlatformHost("shop.platform.example.com", PROD)).toBe(true);
    expect(isPlatformHost("acme.shop.platform.example.com", PROD)).toBe(true);
  });

  test("works for the dev apex too", () => {
    expect(isPlatformHost("acme.shop.platform.example.localhost", DEV)).toBe(true);
    expect(isPlatformHost("dazzling-dijkstra-identity.platform.example.localhost", DEV)).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPlatformHost("Identity.Platform.Example.COM", PROD)).toBe(true);
  });

  test.each([
    ["evil.com", PROD],
    // suffix-without-dot must not slip through ("…platform.example.com" with no label boundary)
    ["evilplatform.example.com", PROD],
    // lookalike that merely contains the apex as a substring
    ["platform.example.com.evil.com", PROD],
    // off-apex host on a workers.dev subdomain is untrusted
    ["app-marketing-staging.example.workers.dev", PROD],
  ])("rejects untrusted host %s", (host, domain) => {
    expect(isPlatformHost(host, domain)).toBe(false);
  });

  test("rejects everything when no apex is configured", () => {
    expect(isPlatformHost("identity.platform.example.com", undefined)).toBe(false);
    expect(isPlatformHost("identity.platform.example.com", "")).toBe(false);
  });
});

describe("resolveReturnTo", () => {
  test("passes through same-origin relative paths", () => {
    expect(resolveReturnTo("/account", PROD)).toBe("/account");
    expect(resolveReturnTo("/orgs/accept/abc?x=1", PROD)).toBe("/orgs/accept/abc?x=1");
  });

  test("accepts absolute URLs under the controlled apex verbatim", () => {
    const url = "https://acme.shop.platform.example.com/hub?ref=signin";
    expect(resolveReturnTo(url, PROD)).toBe(url);
    expect(resolveReturnTo("https://shop.platform.example.localhost/hub", DEV)).toBe(
      "https://shop.platform.example.localhost/hub",
    );
  });

  test("ignores a port on an otherwise-trusted host", () => {
    const url = "https://shop.platform.example.localhost:8788/hub";
    expect(resolveReturnTo(url, DEV)).toBe(url);
  });

  test.each([
    // protocol-relative + UNC-style open-redirect vectors
    ["//evil.com", PROD],
    ["/\\evil.com", PROD],
    // off-apex absolute URL
    ["https://evil.com/phish", PROD],
    // userinfo trick — real host is evil.com
    ["https://acme.shop.platform.example.com@evil.com/phish", PROD],
    // non-http(s) schemes
    ["javascript:alert(1)", PROD],
    ["data:text/html,hi", PROD],
    // unparseable
    ["::::", PROD],
  ])("rejects %s", (value, domain) => {
    expect(resolveReturnTo(value, domain)).toBeUndefined();
  });

  test("returns undefined for empty / missing input", () => {
    expect(resolveReturnTo(undefined, PROD)).toBeUndefined();
    expect(resolveReturnTo("", PROD)).toBeUndefined();
  });
});
