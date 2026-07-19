#!/usr/bin/env bun
// Idempotent local-dev seed: one active demo product (base + draft + a
// published release) with two in-stock variant sizes, so the storefront grid
// and Operator's catalog aren't empty on first boot. Fixed ids + INSERT OR
// IGNORE make re-runs a no-op. Local D1 only (see scripts/dev-config d1Exec).
import { resolve, dirname } from "node:path";
import { d1Exec } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const now = Date.now();

const PRODUCT_ID = "seed-prod-fieldtee";
const RELEASE_ID = "seed-rel-fieldtee-1";

// 1. Base identity row (status starts draft; flipped to active + pointed at
//    the release once it exists — active_release_id FKs into product_release).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product
     (id, slug, status, created_by_sub, created_at, updated_at)
   VALUES
     ('${PRODUCT_ID}', 'field-notes-tee', 'draft', 'seed', ${now}, ${now});`,
);

// 2. Editable working copy (Operator's catalog form reads this).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product_draft
     (product_id, revision, title, description_markdown, price_cents, updated_by_sub, updated_at)
   VALUES
     ('${PRODUCT_ID}', 1, 'Field Notes Tee',
      'A heavyweight tee rendered as a technical drawing.', 3800, 'seed', ${now});`,
);

// 3. Published release (public/checkout reads source title + price from here).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product_release
     (id, product_id, version, slug, title, description_markdown, price_cents, published_by_sub, published_at)
   VALUES
     ('${RELEASE_ID}', '${PRODUCT_ID}', '1', 'field-notes-tee', 'Field Notes Tee',
      'A heavyweight tee rendered as a technical drawing.', 3800, 'seed', ${now});`,
);

// 4. Publish: flip the base row active and point it at the release.
d1Exec(
  pkgDir,
  `UPDATE product SET status = 'active', active_release_id = '${RELEASE_ID}', updated_at = ${now}
   WHERE id = '${PRODUCT_ID}' AND active_release_id IS NULL;`,
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
