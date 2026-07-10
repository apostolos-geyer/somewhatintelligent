/**
 * The consumer-owned billing catalog: the single source of truth the
 * Stripe account is provisioned from (scripts/billing.ts sync) and that
 * subscription plans will be priced from once tiers are declared
 * (./config.ts would read the generated ids from ./billing.gen).
 *
 * `managedBy: "si"` preserves the historical MANAGED_BY_VALUE identity
 * (the metadata marker on managed Stripe objects); the product/price keys
 * are the stable `config_key` identities, so keeping them keeps first-sync
 * an adoption, not a duplication.
 */
import { defineBillingCatalog } from "@somewhatintelligent/stripe";

// Deliberately empty: no tiers are declared yet (billing schema is still
// provisioned via `billing: { plans: [] }` in ./config.ts). When tiers
// land, declare products/prices here, run `bun scripts/billing.ts sync`,
// and reference the generated ids from ./billing.gen in config.ts plans.
export const catalog = defineBillingCatalog({
  managedBy: "si",
  currency: "cad",
  products: {},
  prices: {},
  archived: {
    products: [],
    prices: [],
  },
});
