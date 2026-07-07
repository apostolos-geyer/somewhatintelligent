#!/usr/bin/env bun
// Idempotent local-dev seed: one active demo product with two in-stock sizes so
// the storefront grid isn't empty on first boot. Fixed ids + INSERT OR IGNORE
// make re-runs a no-op. Local D1 only (see scripts/dev-config d1Exec).
import { resolve, dirname } from "node:path";
import { d1Exec } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const now = Date.now();

const PRODUCT_ID = "seed-prod-fieldtee";
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product
     (id, slug, title, description, price_cents, status, created_by, created_at, updated_at)
   VALUES
     ('${PRODUCT_ID}', 'field-notes-tee', 'Field Notes Tee',
      'A heavyweight tee rendered as a technical drawing.', 3800, 'active', 'seed', ${now}, ${now});`,
);

const variants: Array<[string, string, string, number]> = [
  ["seed-var-ft-m", "M", "FIELD-NOTES-TEE-M", 24],
  ["seed-var-ft-l", "L", "FIELD-NOTES-TEE-L", 18],
];
for (const [id, size, sku, stock] of variants) {
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO product_variant (id, product_id, size, sku, stock, created_at)
     VALUES ('${id}', '${PRODUCT_ID}', '${size}', '${sku}', ${stock}, ${now});`,
  );
}

console.log("  [seed] workers/store: demo product 'Field Notes Tee' (M/L) ready");
