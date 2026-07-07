/**
 * Open-redirect guard for post-auth `returnTo` targets. Exercises the env-free
 * core (`resolveReturnTo` / `isPlatformHost`) against the controlled apex so the
 * cross-subdomain trust rule is pinned in every environment shape.
 */
import { describe, expect, test } from "vitest";
import { isPlatformHost, resolveReturnTo } from "@/lib/return-to";

const PROD = ".sproutportal.ca";
const DEV = ".sproutportal.localhost";

describe("isPlatformHost", () => {
  test("matches the bare apex", () => {
    expect(isPlatformHost("sproutportal.ca", PROD)).toBe(true);
  });

  test("matches single- and multi-label subdomains (brand portals)", () => {
    expect(isPlatformHost("identity.sproutportal.ca", PROD)).toBe(true);
    expect(isPlatformHost("sprout.sproutportal.ca", PROD)).toBe(true);
    expect(isPlatformHost("acme.sprout.sproutportal.ca", PROD)).toBe(true);
  });

  test("works for the dev apex too", () => {
    expect(isPlatformHost("acme.sprout.sproutportal.localhost", DEV)).toBe(true);
    expect(isPlatformHost("dazzling-dijkstra-identity.sproutportal.localhost", DEV)).toBe(true);
  });

  test("is case-insensitive", () => {
    expect(isPlatformHost("Identity.SproutPortal.CA", PROD)).toBe(true);
  });

  test.each([
    ["evil.com", PROD],
    // suffix-without-dot must not slip through ("…sproutportal.ca" with no label boundary)
    ["evilsproutportal.ca", PROD],
    // lookalike that merely contains the apex as a substring
    ["sproutportal.ca.evil.com", PROD],
    // off-apex host (e.g. staging marketing on workers.dev) is no longer trusted
    ["sprout-marketing-staging.sproutcannabis.workers.dev", PROD],
  ])("rejects untrusted host %s", (host, domain) => {
    expect(isPlatformHost(host, domain)).toBe(false);
  });

  test("rejects everything when no apex is configured", () => {
    expect(isPlatformHost("identity.sproutportal.ca", undefined)).toBe(false);
    expect(isPlatformHost("identity.sproutportal.ca", "")).toBe(false);
  });
});

describe("resolveReturnTo", () => {
  test("passes through same-origin relative paths", () => {
    expect(resolveReturnTo("/account", PROD)).toBe("/account");
    expect(resolveReturnTo("/orgs/accept/abc?x=1", PROD)).toBe("/orgs/accept/abc?x=1");
  });

  test("accepts absolute URLs under the controlled apex verbatim", () => {
    const url = "https://acme.sprout.sproutportal.ca/hub?ref=signin";
    expect(resolveReturnTo(url, PROD)).toBe(url);
    expect(resolveReturnTo("https://sprout.sproutportal.localhost/hub", DEV)).toBe(
      "https://sprout.sproutportal.localhost/hub",
    );
  });

  test("ignores a port on an otherwise-trusted host", () => {
    const url = "https://sprout.sproutportal.localhost:8788/hub";
    expect(resolveReturnTo(url, DEV)).toBe(url);
  });

  test.each([
    // protocol-relative + UNC-style open-redirect vectors
    ["//evil.com", PROD],
    ["/\\evil.com", PROD],
    // off-apex absolute URL
    ["https://evil.com/phish", PROD],
    // userinfo trick — real host is evil.com
    ["https://acme.sprout.sproutportal.ca@evil.com/phish", PROD],
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
