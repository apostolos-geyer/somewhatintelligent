import type { BillingInterval, ProductTier } from "./types";

/**
 * Product definitions — source of truth for Stripe products.
 *
 * Single subscription tier for this fork. `scripts/sync.ts` is idempotent
 * and keyed on the object key (not the name), so adding a second tier later
 * is just adding another entry here + a price in `prices` below.
 */
export const products = {
  member: {
    name: "Member",
    description: "Recurring membership subscription.",
    tier: "member" as ProductTier,
  },
} as const;

/**
 * Price definitions — source of truth for Stripe prices.
 *
 * PLACEHOLDER pricing ($10.00 CAD/month) — the owner sets real pricing
 * before onboarding a live Stripe account (see README.md). Prices are
 * immutable in Stripe once created, so changing `amount` after `sync` has
 * run against a real account creates a NEW price rather than editing the
 * old one; `validate.ts` will flag the drift.
 */
export const prices = {
  member_monthly: {
    product: "member",
    amount: 1000,
    interval: "month" as BillingInterval,
  },
} as const;

export type ProductKey = keyof typeof products;
export type PriceKey = keyof typeof prices;
