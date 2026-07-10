/**
 * Catalog-shape invariants for si's billing catalog (re-homed from the
 * retired @si/stripe's config.test.ts). The catalog is DELIBERATELY empty:
 * billing schema is provisioned (`billing: { plans: [] }` in src/config.ts)
 * but no tiers are declared yet. What must hold until tiers land: the
 * historical `managedBy: "si"` marker (Stripe `managed_by` identity), CAD
 * currency, and zero products/prices/archived entries — an accidental
 * declaration here would provision real Stripe objects on the next sync.
 */
import { catalog } from "../src/billing.catalog";

describe("billing catalog shape", () => {
  test("managedBy preserves the historical 'si' marker", () => {
    expect(catalog.managedBy).toBe("si");
  });

  test("currency is CAD", () => {
    expect(catalog.currency).toBe("cad");
  });

  test("no tiers declared yet: zero products and prices", () => {
    expect(Object.keys(catalog.products)).toEqual([]);
    expect(Object.keys(catalog.prices)).toEqual([]);
  });

  test("nothing archived", () => {
    expect(catalog.archived?.products ?? []).toEqual([]);
    expect(catalog.archived?.prices ?? []).toEqual([]);
  });
});
