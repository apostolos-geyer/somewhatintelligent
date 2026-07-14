import { describe, expect, test } from "vitest";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { STORE_LIVE } from "@/lib/config";
import { storeOpenFor } from "@/lib/store-gate";

const sessionWithRole = (role: string) => ({ user: { role } }) as PlatformSession;

describe("storeOpenFor", () => {
  test("admins always pass, live or not", () => {
    expect(storeOpenFor(sessionWithRole("admin"), false)).toBe(true);
    expect(storeOpenFor(sessionWithRole("user,admin"), false)).toBe(true);
    expect(storeOpenFor(sessionWithRole("admin"), true)).toBe(true);
  });

  test("everyone else is gated on the env's launch flag", () => {
    expect(storeOpenFor(null, false)).toBe(false);
    expect(storeOpenFor(undefined, false)).toBe(false);
    expect(storeOpenFor(sessionWithRole("user"), false)).toBe(false);
    expect(storeOpenFor(sessionWithRole("trusted"), false)).toBe(false);

    expect(storeOpenFor(null, true)).toBe(true);
    expect(storeOpenFor(sessionWithRole("user"), true)).toBe(true);
  });

  test("defaults to the baked-in STORE_LIVE var (unset ⇒ closed under vitest)", () => {
    // vitest builds with an empty define map, so the wrangler var is absent
    // and the parse in config.ts must fail closed.
    expect(STORE_LIVE).toBe(false);
    expect(storeOpenFor(null)).toBe(false);
    expect(storeOpenFor(sessionWithRole("admin"))).toBe(true);
  });
});
