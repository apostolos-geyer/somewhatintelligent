#!/usr/bin/env bun
/**
 * Stripe IaC Fetch Script (READ-ONLY)
 *
 * Fetches existing Stripe products/prices and generates src/generated.ts.
 * Does NOT create or update any Stripe resources.
 *
 * Without STRIPE_SECRET_KEY (the default in every current env — this plugin
 * ships dormant), writes a typed STUB with empty-string ids and exits 0. This
 * is what lets a fresh clone / CI typecheck with zero secrets: `bun run
 * typecheck` in this package runs `fetch` first (see package.json).
 *
 * Run `sync.ts` (with a real STRIPE_SECRET_KEY) to create/update resources.
 *
 * Usage:
 *   bun run fetch
 *   bun run fetch:strict
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prices, products } from "../src/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = path.join(__dirname, "../src/generated.ts");

// Check for offline mode BEFORE importing the Stripe SDK — keeps this path
// fully network-free.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  // Offline mode: generate a stub with the correct type shape for typecheck.
  console.log("⚠️  STRIPE_SECRET_KEY not set — generating stub generated.ts for offline typecheck");

  const stubProducts = Object.keys(products)
    .map((k) => `  ${k}: "" as const,`)
    .join("\n");
  const stubPrices = Object.keys(prices)
    .map((k) => `  ${k}: "" as const,`)
    .join("\n");

  const stub = `// AUTO-GENERATED STUB (offline mode) - DO NOT EDIT
// Run \`bun run fetch\` with STRIPE_SECRET_KEY to get real IDs

export const stripeProducts = {
${stubProducts}
} as const;

export const stripePrices = {
${stubPrices}
} as const;

export type StripeProductId =
  (typeof stripeProducts)[keyof typeof stripeProducts];
export type StripePriceId = (typeof stripePrices)[keyof typeof stripePrices];
`;

  fs.writeFileSync(GENERATED_PATH, stub);
  console.log(`  ✅ Stub written to ${path.relative(process.cwd(), GENERATED_PATH)}`);
  process.exit(0);
}

// Dynamic import — only load the Stripe SDK when we actually need it.
const { default: Stripe } = await import("stripe");
const { CONFIG_KEY, MANAGED_BY_KEY, MANAGED_BY_VALUE } = await import("../src/types");

// Parse CLI args
const args = process.argv.slice(2);
// Strict mode: fail if resources missing (auto-enabled in production)
const isStrict = args.includes("--strict") || process.env.NODE_ENV === "production";

const isLiveMode = STRIPE_SECRET_KEY.startsWith("sk_live_");
const modeLabel = isLiveMode ? "LIVE" : "test";

const stripe = new Stripe(STRIPE_SECRET_KEY);

console.log(`📥 Fetching Stripe configuration (${modeLabel} mode)...\n`);

// Track found IDs
const productIds: Record<string, string> = {};
const priceIds: Record<string, string> = {};
let hasErrors = false;

// ============================================================================
// PRODUCTS
// ============================================================================
console.log("Products:");

const existingProducts = await stripe.products.list({ limit: 100 });
const managedProducts = existingProducts.data.filter(
  (p) => p.metadata[MANAGED_BY_KEY] === MANAGED_BY_VALUE,
);

for (const [key, config] of Object.entries(products)) {
  const existing = managedProducts.find((p) => p.metadata[CONFIG_KEY] === key);

  if (existing) {
    console.log(`  ✅ ${config.name} (${existing.id})`);
    productIds[key] = existing.id;
  } else {
    console.log(`  ❌ ${config.name} - NOT FOUND`);
    hasErrors = true;
  }
}

// ============================================================================
// PRICES
// ============================================================================
console.log("\nPrices:");

const existingPrices = await stripe.prices.list({ limit: 100 });
const managedPrices = existingPrices.data.filter(
  (p) => p.metadata[MANAGED_BY_KEY] === MANAGED_BY_VALUE,
);

for (const [key, config] of Object.entries(prices)) {
  const existing = managedPrices.find((p) => p.metadata[CONFIG_KEY] === key);

  if (existing) {
    const displayAmount = (config.amount / 100).toFixed(2);
    console.log(`  ✅ ${key} (${existing.id}) - $${displayAmount}/${config.interval}`);
    priceIds[key] = existing.id;
  } else {
    console.log(`  ❌ ${key} - NOT FOUND`);
    hasErrors = true;
  }
}

// ============================================================================
// GENERATE generated.ts
// ============================================================================

// In strict mode, fail if any resources are missing
if (hasErrors && isStrict) {
  console.error("\n❌ STRICT MODE: Some products/prices are missing from Stripe.");
  console.error("   Run `bun run sync` to create them first.");
  process.exit(1);
}

console.log("\n📝 Generating src/generated.ts...");

const timestamp = new Date().toISOString();

// If resources are missing (non-strict), generate placeholder with empty
// strings — typecheck still passes, runtime fails with a clear error.
if (hasErrors) {
  console.warn("\n⚠️  Some products/prices are missing from Stripe.");
  console.warn("   Run `bun run sync` to create them.");
  console.warn("   Generating placeholder file with empty values...\n");

  for (const key of Object.keys(products)) {
    if (!productIds[key]) {
      productIds[key] = "";
    }
  }
  for (const key of Object.keys(prices)) {
    if (!priceIds[key]) {
      priceIds[key] = "";
    }
  }
}

const content = `// AUTO-GENERATED by scripts/fetch.ts - DO NOT EDIT
// Run \`bun run fetch\` to regenerate
// Last fetched: ${timestamp}
// Environment: ${modeLabel}
${hasErrors ? "// ⚠️  WARNING: Some IDs are empty - run bun run sync first!\n" : ""}
export const stripeProducts = {
${Object.entries(productIds)
  .map(([key, id]) => `  ${key}: "${id}" as const,`)
  .join("\n")}
} as const;

export const stripePrices = {
${Object.entries(priceIds)
  .map(([key, id]) => `  ${key}: "${id}" as const,`)
  .join("\n")}
} as const;

export type StripeProductId =
  (typeof stripeProducts)[keyof typeof stripeProducts];
export type StripePriceId = (typeof stripePrices)[keyof typeof stripePrices];
`;

fs.writeFileSync(GENERATED_PATH, content);
console.log(`  ✅ Written to ${path.relative(process.cwd(), GENERATED_PATH)}`);

if (hasErrors) {
  console.log("\n⚠️  Fetch complete with warnings (missing resources)");
} else {
  console.log("\n✅ Fetch complete!");
}
