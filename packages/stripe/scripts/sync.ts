#!/usr/bin/env bun
/**
 * Stripe IaC Sync Script
 *
 * Creates/updates Stripe products and prices based on src/config.ts.
 * Regenerates src/generated.ts with actual Stripe IDs. Idempotent — resources
 * are matched by `metadata.config_key` (the config object key, e.g.
 * `"member_monthly"`), never by name, so renaming `products.member.name`
 * updates the existing product instead of creating a duplicate.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... bun run sync
 *   STRIPE_SECRET_KEY=sk_test_... bun run sync -- --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";
import { prices, products } from "../src/config";
import { CONFIG_KEY, CURRENCY, MANAGED_BY_KEY, MANAGED_BY_VALUE } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_PATH = path.join(__dirname, "../src/generated.ts");

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");

// Validate environment
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

const isLiveMode = STRIPE_SECRET_KEY.startsWith("sk_live_");
const modeLabel = isLiveMode ? "LIVE" : "test";

if (isLiveMode) {
  console.warn("⚠️  WARNING: Running against LIVE Stripe account!");
  console.warn("⚠️  Press Ctrl+C within 5 seconds to abort...\n");
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const stripe = new Stripe(STRIPE_SECRET_KEY);

console.log(`🔄 Syncing Stripe configuration (${modeLabel} mode)...`);
if (isDryRun) {
  console.log("📋 DRY RUN - no changes will be made\n");
} else {
  console.log("");
}

// Track created/found IDs
const productIds: Record<string, string> = {};
const priceIds: Record<string, string> = {};

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
    const needsUpdate =
      existing.description !== config.description || existing.name !== config.name;

    if (needsUpdate && !isDryRun) {
      await stripe.products.update(existing.id, {
        name: config.name,
        description: config.description,
      });
      console.log(`  📝 ${config.name} (${existing.id}) - updated`);
    } else if (needsUpdate) {
      console.log(`  📝 ${config.name} (${existing.id}) - would update`);
    } else {
      console.log(`  ✅ ${config.name} (${existing.id}) - exists`);
    }
    productIds[key] = existing.id;
  } else {
    if (isDryRun) {
      console.log(`  🆕 ${config.name} - would create`);
      productIds[key] = `prod_DRYRUN_${key}`;
    } else {
      const product = await stripe.products.create({
        name: config.name,
        description: config.description,
        metadata: {
          [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
          [CONFIG_KEY]: key,
          tier: config.tier,
        },
      });
      console.log(`  🆕 ${config.name} (${product.id}) - created`);
      productIds[key] = product.id;
    }
  }
}

// ============================================================================
// PRICES
// ============================================================================
console.log("\nPrices:");

const existingPrices = await stripe.prices.list({ limit: 100, expand: ["data.product"] });
const managedPrices = existingPrices.data.filter(
  (p) => p.metadata[MANAGED_BY_KEY] === MANAGED_BY_VALUE,
);

for (const [key, config] of Object.entries(prices)) {
  const existing = managedPrices.find((p) => p.metadata[CONFIG_KEY] === key);

  if (existing) {
    // Prices are immutable in Stripe, so we just verify they match.
    const matches =
      existing.unit_amount === config.amount && existing.recurring?.interval === config.interval;

    if (!matches) {
      console.warn(`  ⚠️  ${key} (${existing.id}) - config drift detected!`);
      console.warn(`      Expected: ${config.amount} / ${config.interval}`);
      console.warn(`      Actual: ${existing.unit_amount} / ${existing.recurring?.interval}`);
    } else {
      console.log(`  ✅ ${key} (${existing.id}) - exists`);
    }
    priceIds[key] = existing.id;
  } else {
    const productId = productIds[config.product];
    if (!productId) {
      console.error(`  ❌ ${key} - product "${config.product}" not found`);
      continue;
    }

    if (isDryRun) {
      console.log(
        `  🆕 ${key} - would create ($${(config.amount / 100).toFixed(2)}/${config.interval})`,
      );
      priceIds[key] = `price_DRYRUN_${key}`;
    } else {
      const price = await stripe.prices.create({
        product: productId,
        unit_amount: config.amount,
        currency: CURRENCY,
        recurring: { interval: config.interval },
        metadata: {
          [MANAGED_BY_KEY]: MANAGED_BY_VALUE,
          [CONFIG_KEY]: key,
        },
      });
      console.log(`  🆕 ${key} (${price.id}) - created`);
      priceIds[key] = price.id;
    }
  }
}

// ============================================================================
// GENERATE generated.ts
// ============================================================================
if (isDryRun) {
  console.log("\n📋 DRY RUN - skipping generated.ts update");
  console.log("\n✅ Dry run complete!");
} else {
  console.log("\n📝 Generating src/generated.ts...");

  const timestamp = new Date().toISOString();
  const content = `// AUTO-GENERATED by scripts/sync.ts - DO NOT EDIT
// Run \`bun run sync\` (from packages/stripe) to regenerate
// Last synced: ${timestamp}
// Environment: ${modeLabel}

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

  console.log("\n✅ Sync complete!");
}
