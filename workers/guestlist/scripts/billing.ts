#!/usr/bin/env bun
/**
 * Billing provisioning entry — the whole consumer-side integration:
 *
 *   bun scripts/billing.ts fetch            # ids only (offline stub w/o key)
 *   STRIPE_SECRET_KEY=… bun scripts/billing.ts sync [--dry-run]
 *   STRIPE_SECRET_KEY=… bun scripts/billing.ts validate   # the CD gate
 */
import { fileURLToPath } from "node:url";
import { runBillingCli } from "@somewhatintelligent/stripe/cli";
import { catalog } from "../src/billing.catalog";

process.exit(
  await runBillingCli(catalog, {
    generatedPath: fileURLToPath(new URL("../src/billing.gen.ts", import.meta.url)),
  }),
);
