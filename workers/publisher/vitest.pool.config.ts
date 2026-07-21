import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

/**
 * D1 integration harness — runs `__tests__/integration/*.itest.ts` INSIDE
 * workerd (miniflare) against a REAL local D1, so the Publisher schema's
 * constraints (unique indexes, CHECK constraints, FK cascade/SET NULL) are
 * exercised for real, not asserted by re-reading source. Mirrors
 * workers/store/vitest.pool.config.ts.
 *
 * Separate from the node `vp test` block so the two runners never collide:
 * node/unit tests are `*.test.ts`, pool tests `*.itest.ts`. Run with
 * `bun run test:pool`. Miniflare bindings are declared explicitly (D1 + the
 * migrations bundle) rather than pointing at wrangler.jsonc — that config
 * carries a ROADIE service binding miniflare can't boot, and the schema tests
 * need none of it.
 *
 * `STORE` binds an auxiliary worker-side `StoreCatalog` stub (T17): a real
 * `WorkerEntrypoint` answering `getProductById` from its own D1, seeded by the
 * test over RPC. Page-publish reference validation therefore crosses a real RPC
 * boundary into a real StoreCatalog surface, not a mocked function.
 */

// Inline ESM for the auxiliary StoreCatalog stub. It imports only the workerd
// `cloudflare:workers` builtin, so miniflare needs no bundling. `seedProduct`
// lets a test seed its OWN product rows; `getProductById` answers from them,
// returning the `not_found` DomainResult for any unseeded id.
const STORE_CATALOG_STUB = /* js */ `
import { WorkerEntrypoint } from "cloudflare:workers";

const CREATE = "CREATE TABLE IF NOT EXISTS stub_product " +
  "(id TEXT PRIMARY KEY, slug TEXT NOT NULL, title TEXT NOT NULL, price_cents INTEGER NOT NULL, status TEXT NOT NULL)";

export class StoreCatalog extends WorkerEntrypoint {
  async seedProduct({ id, slug, title, priceCents = 1000, status = "active" }) {
    await this.env.STORE_DB.exec(CREATE);
    await this.env.STORE_DB
      .prepare("INSERT OR REPLACE INTO stub_product (id, slug, title, price_cents, status) VALUES (?1, ?2, ?3, ?4, ?5)")
      .bind(id, slug, title, priceCents, status)
      .run();
    return { ok: true, value: { id } };
  }

  async getProductById({ productId }) {
    await this.env.STORE_DB.exec(CREATE);
    const row = await this.env.STORE_DB
      .prepare("SELECT id, slug, title, price_cents FROM stub_product WHERE id = ?1 AND status = 'active'")
      .bind(productId)
      .first();
    if (row === null) return { ok: false, error: "not_found" };
    return {
      ok: true,
      value: {
        id: row.id,
        slug: row.slug,
        version: "1.0.0",
        title: row.title,
        descriptionExcerpt: null,
        priceCents: row.price_cents,
        currency: "CAD",
        coverMediaId: null,
        availability: "available",
        totalStock: 1,
        descriptionMarkdown: null,
        media: [],
        variants: [],
      },
    };
  }
}

export default {
  fetch() {
    return new Response("store-catalog-stub", { status: 200 });
  },
};
`;

export default defineConfig({
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
      return {
        miniflare: {
          compatibilityDate: "2026-04-19",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: { TEST_MIGRATIONS: migrations },
          serviceBindings: {
            STORE: { name: "store-catalog-stub", entrypoint: "StoreCatalog" },
          },
          workers: [
            {
              name: "store-catalog-stub",
              compatibilityDate: "2026-04-19",
              compatibilityFlags: ["nodejs_compat"],
              d1Databases: { STORE_DB: "store-catalog-stub-db" },
              modules: [
                { type: "ESModule", path: "store-catalog-stub.mjs", contents: STORE_CATALOG_STUB },
              ],
            },
          ],
        },
      };
    }),
  ],
  lint: {
    ignorePatterns: ["__tests__/**/*"],
  },
  test: {
    globals: true,
    include: ["__tests__/integration/**/*.itest.ts"],
    setupFiles: ["__tests__/integration/apply-migrations.ts"],
  },
});
