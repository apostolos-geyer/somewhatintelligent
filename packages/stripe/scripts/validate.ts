#!/usr/bin/env bun
/**
 * Stripe IaC Validation Script
 *
 * Verifies that Stripe resources match src/config.ts.
 * Reports drift (missing products, wrong prices).
 *
 * Exit 0 = valid, Exit 1 = drift detected
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... bun run validate
 */

import Stripe from "stripe";
import { archived, prices, products } from "../src/config";
import { CONFIG_KEY, CURRENCY, MANAGED_BY_KEY, MANAGED_BY_VALUE } from "../src/types";

// Validate environment
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  console.error("❌ STRIPE_SECRET_KEY environment variable is required");
  process.exit(1);
}

const isLiveMode = STRIPE_SECRET_KEY.startsWith("sk_live_");
const modeLabel = isLiveMode ? "LIVE" : "test";

const stripe = new Stripe(STRIPE_SECRET_KEY);

console.log(`🔍 Validating Stripe configuration (${modeLabel} mode)...\n`);

let hasErrors = false;
let hasWarnings = false;
const archivedProducts = new Set<string>(archived.products);
const archivedPrices = new Set<string>(archived.prices);

// ============================================================================
// PRODUCTS
// ============================================================================
console.log("Products:");

const existingProducts = await stripe.products.list({ limit: 100 });
const managedProducts = existingProducts.data.filter(
  (p) => p.metadata[MANAGED_BY_KEY] === MANAGED_BY_VALUE,
);

const productIds: Record<string, string> = {};

for (const [key, config] of Object.entries(products)) {
  const existing = managedProducts.find((p) => p.metadata[CONFIG_KEY] === key);

  if (!existing) {
    console.log(`  ❌ ${config.name} - MISSING`);
    hasErrors = true;
  } else {
    productIds[key] = existing.id;

    const drifts: string[] = [];
    if (existing.name !== config.name) {
      drifts.push(`name: "${existing.name}" vs "${config.name}"`);
    }
    if (existing.description !== config.description) {
      drifts.push(`description differs`);
    }

    if (drifts.length > 0) {
      console.log(`  ⚠️  ${config.name} (${existing.id}) - drift detected`);
      for (const drift of drifts) {
        console.log(`      ${drift}`);
      }
      hasWarnings = true;
    } else {
      console.log(`  ✅ ${config.name} (${existing.id})`);
    }
  }
}

// Check for orphaned products (in Stripe but not in config)
for (const product of managedProducts) {
  const configKey = product.metadata[CONFIG_KEY];
  if (configKey && !(configKey in products)) {
    if (archivedProducts.has(configKey)) {
      console.log(`  🗄️  ${product.name} (${product.id}) - archived`);
    } else {
      console.log(`  ❌ ${product.name} (${product.id}) - orphaned (not in config)`);
      hasErrors = true;
    }
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

  if (!existing) {
    console.log(`  ❌ ${key} - MISSING`);
    hasErrors = true;
  } else {
    const drifts: string[] = [];

    if (existing.unit_amount !== config.amount) {
      drifts.push(`amount: ${existing.unit_amount} vs ${config.amount}`);
    }
    if (existing.recurring?.interval !== config.interval) {
      drifts.push(`interval: ${existing.recurring?.interval} vs ${config.interval}`);
    }
    if (existing.currency !== CURRENCY) {
      drifts.push(`currency: ${existing.currency} vs ${CURRENCY}`);
    }

    const expectedProductId = productIds[config.product];
    const actualProductId =
      typeof existing.product === "string" ? existing.product : existing.product?.id;

    if (expectedProductId && actualProductId !== expectedProductId) {
      drifts.push(`product: ${actualProductId} vs ${expectedProductId}`);
    }

    if (drifts.length > 0) {
      console.log(`  ⚠️  ${key} (${existing.id}) - drift detected`);
      for (const drift of drifts) {
        console.log(`      ${drift}`);
      }
      hasWarnings = true;
    } else {
      const displayAmount = (config.amount / 100).toFixed(2);
      console.log(`  ✅ ${key} (${existing.id}) - $${displayAmount}/${config.interval}`);
    }
  }
}

// Check for orphaned prices
for (const price of managedPrices) {
  const configKey = price.metadata[CONFIG_KEY];
  if (configKey && !(configKey in prices)) {
    if (archivedPrices.has(configKey)) {
      console.log(`  🗄️  ${configKey} (${price.id}) - archived`);
    } else {
      console.log(`  ❌ ${configKey} (${price.id}) - orphaned (not in config)`);
      hasErrors = true;
    }
  }
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log("");

if (hasErrors) {
  console.log("❌ Validation FAILED - missing resources or unmanaged orphans detected");
  console.log(
    "   Run `bun run sync` to create missing resources, or add intentional removals to archived",
  );
  process.exit(1);
} else if (hasWarnings) {
  console.log("⚠️  Validation passed with WARNINGS - drift detected");
  console.log("   Run `bun run sync` to fix drift");
  process.exit(0);
} else {
  console.log("✅ Validation passed - Stripe matches config");
  process.exit(0);
}
