import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

/**
 * D1 integration harness — runs `__tests__/integration/*.itest.ts` INSIDE
 * workerd (miniflare) against a REAL local D1, so the server↔DB boundary
 * (schema constraints, unique indexes, cascades, atomic batch decrements) is
 * exercised for real, not asserted by re-reading source. Mirrors
 * greenroom/workers/sprout/vitest.pool.config.ts.
 *
 * Separate from the node `vite.config.ts` test block so the two runners never
 * collide: node/unit tests are `*.test.ts`, pool tests `*.itest.ts`. Run with
 * `bun run test:pool`. We declare the miniflare bindings explicitly (D1 + the
 * migrations bundle) rather than pointing at wrangler.jsonc — that config
 * carries GUESTLIST/ROADIE service bindings miniflare can't boot, and the
 * DB-boundary tests need none of them.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.join(__dirname, "src") },
  },
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
      return {
        miniflare: {
          compatibilityDate: "2026-04-16",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: { TEST_MIGRATIONS: migrations },
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
