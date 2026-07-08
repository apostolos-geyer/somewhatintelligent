import { describe, expect, test } from "vitest";
import { archived, prices, products } from "../src/config";
import { CONFIG_KEY, CURRENCY, MANAGED_BY_KEY, MANAGED_BY_VALUE } from "../src/types";

describe("products", () => {
  test("has stable string keys matching object identity, not display name", () => {
    for (const key of Object.keys(products)) {
      expect(key).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  test("every product has a non-empty name/description and a tier", () => {
    for (const [key, config] of Object.entries(products)) {
      expect(config.name.length, `${key}.name`).toBeGreaterThan(0);
      expect(config.description.length, `${key}.description`).toBeGreaterThan(0);
      expect(config.tier.length, `${key}.tier`).toBeGreaterThan(0);
    }
  });

  test("single-tier invariant: exactly one product for this fork", () => {
    expect(Object.keys(products)).toEqual(["member"]);
  });
});

describe("prices", () => {
  test("every price references an existing product key", () => {
    for (const [key, config] of Object.entries(prices)) {
      expect(
        config.product in products,
        `${key} references unknown product "${config.product}"`,
      ).toBe(true);
    }
  });

  test("every price has a positive integer amount (Stripe unit_amount is smallest-unit cents)", () => {
    for (const [key, config] of Object.entries(prices)) {
      expect(Number.isInteger(config.amount), `${key}.amount must be an integer`).toBe(true);
      expect(config.amount, `${key}.amount must be positive`).toBeGreaterThan(0);
    }
  });

  test("every price has a valid billing interval", () => {
    for (const config of Object.values(prices)) {
      expect(["month", "year"]).toContain(config.interval);
    }
  });

  test("stable keys", () => {
    expect(Object.keys(prices)).toEqual(["member_monthly"]);
  });
});

describe("constants", () => {
  test("currency is CAD (placeholder — owner sets real pricing before go-live)", () => {
    expect(CURRENCY).toBe("cad");
  });

  test("managed-by metadata identifies this fork, not the HiPat source repo", () => {
    expect(MANAGED_BY_VALUE).toBe("si");
    expect(MANAGED_BY_KEY).toBe("managed_by");
    expect(CONFIG_KEY).toBe("config_key");
  });
});

describe("archived resources", () => {
  test("archive lists are explicit config-key allowlists", () => {
    expect(archived.products).toEqual([]);
    expect(archived.prices).toEqual([]);
  });

  test("archived arrays are readonly — mutation is a compile error", () => {
    // Type-check-only: never invoked, so this proves the compile-time guarantee
    // without actually mutating the shared `archived` singleton at runtime
    // (TS `readonly` has no runtime enforcement — a real `.push()` call here
    // would permanently pollute the module-level object for every test).
    function typeCheckOnly() {
      // @ts-expect-error archived.products is readonly string[]
      archived.products.push("prod_test");
      // @ts-expect-error archived.prices is readonly string[]
      archived.prices.push("price_test");
    }
    void typeCheckOnly;
    expect(archived.products).toEqual([]);
    expect(archived.prices).toEqual([]);
  });
});
