/**
 * Product tier identifier. Ships a single paid tier — add more union
 * members here (and a matching entry in `./config`'s `products`) when
 * the business needs more than one.
 */
export type ProductTier = "member";

/** Billing interval */
export type BillingInterval = "month" | "year";

/** Product definition */
export interface ProductConfig {
  name: string;
  description: string;
  tier: ProductTier;
}

/** Price definition */
export interface PriceConfig {
  product: keyof typeof import("./config").products;
  amount: number;
  interval: BillingInterval;
}

/** Default currency for all prices */
export const CURRENCY = "cad" as const;

/** Metadata keys used for idempotent sync. `CONFIG_KEY`'s value is the
 * config object key (e.g. `"member_monthly"`) — the stable identity used to
 * match a Stripe resource back to its config entry. Never the display name,
 * which is free to change without orphaning the resource. */
export const MANAGED_BY_KEY = "managed_by" as const;
export const MANAGED_BY_VALUE = "si" as const;
export const CONFIG_KEY = "config_key" as const;
