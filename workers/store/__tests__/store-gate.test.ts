import { describe, expect, test } from "vitest";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { STORE_LIVE } from "@/lib/config";
import { storeOpenFor } from "@/lib/store-gate";

const sessionWithRole = (role: string) => ({ user: { role } }) as PlatformSession;

describe("storeOpenFor", () => {
  test("admins always pass, live or not", () => {
    expect(storeOpenFor(sessionWithRole("admin"))).toBe(true);
    expect(storeOpenFor(sessionWithRole("user,admin"))).toBe(true);
  });

  test("everyone else is gated on the launch flag", () => {
    expect(storeOpenFor(null)).toBe(STORE_LIVE);
    expect(storeOpenFor(undefined)).toBe(STORE_LIVE);
    expect(storeOpenFor(sessionWithRole("user"))).toBe(STORE_LIVE);
    expect(storeOpenFor(sessionWithRole("trusted"))).toBe(STORE_LIVE);
  });
});
