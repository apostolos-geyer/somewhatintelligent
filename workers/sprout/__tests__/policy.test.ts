import { describe, expect, test } from "vitest";
import { decideBrandAdmin, isPlatformAdmin } from "@/lib/policy.server";

describe("isPlatformAdmin", () => {
  test("matches a comma-separated multi-role string (never === 'admin')", () => {
    expect(isPlatformAdmin("admin,user")).toBe(true);
    expect(isPlatformAdmin("user,admin")).toBe(true);
    expect(isPlatformAdmin("admin")).toBe(true);
  });
  test("rejects non-admin roles + nullish", () => {
    expect(isPlatformAdmin("user")).toBe(false);
    expect(isPlatformAdmin("")).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
    expect(isPlatformAdmin(undefined)).toBe(false);
  });
});

describe("decideBrandAdmin", () => {
  test("platform admin always passes regardless of org role", () => {
    expect(decideBrandAdmin({ actorRole: "admin,user", orgRole: null })).toEqual({ ok: true });
  });
  test("org owner/admin pass; member is read-only", () => {
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "owner" })).toEqual({ ok: true });
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "admin" })).toEqual({ ok: true });
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "member" })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(decideBrandAdmin({ actorRole: "user", orgRole: null })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});
