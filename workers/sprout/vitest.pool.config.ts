import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";

/**
 * idiom-A integration harness — runs `__tests__/integration/*.itest.ts` INSIDE
 * workerd (miniflare) against a REAL local D1, so the server↔DB boundary (schema
 * constraints, cascades, unique indexes — the load-bearing compliance laws) is
 * exercised for real, not asserted by source-scanning.
 *
 * Separate from the node `vite.config.ts` test block (idiom-B, pure logic) so the
 * two runners never collide: node tests are `*.test.ts`, pool tests `*.itest.ts`.
 * Run with `bun run test:pool`. We declare the miniflare bindings explicitly
 * (D1 + the migrations bundle) rather than pointing at the rendered
 * `wrangler.jsonc` — that config carries remote-only AI/Vectorize/Browser
 * bindings miniflare can't boot, and the DB-boundary tests need none of them.
 */
export default defineConfig({
  // The app source uses the `@/…` alias (→ src); the node vite.config wires it
  // via its plugin set, so mirror it here for the pool runner.
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
