import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";
import { platformDeployConfig } from "@greenroom/config/deploy";

// Worker-name prefix (mirrors workers/bouncer's vite.config): the checked-in
// wrangler.jsonc (top level = staging) resolves service bindings to
// `<prefix>-<service>-staging`, so the stub workers below must carry the same
// prefix AND `-staging` suffix or miniflare can't bind them at boot.
// Config-derived so a rebrand can't restale the prefix.
const wp = platformDeployConfig.workerPrefix ? `${platformDeployConfig.workerPrefix}-` : "";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, "migrations");
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { TEST_MIGRATIONS: migrations },
          // Resolve the PROMOTER service binding with a no-op stub so
          // miniflare can start. Sign-up tests hit sendVerificationEmail
          // transitively; the stub mirrors the real worker's shape when
          // RESEND_API_KEY is unset.
          workers: [
            {
              name: `${wp}promoter-staging`,
              modules: true,
              scriptPath: path.join(__dirname, "__tests__/mocks/promoter-stub.js"),
            },
            {
              name: `${wp}roadie-staging`,
              modules: true,
              scriptPath: path.join(__dirname, "__tests__/mocks/roadie-stub.js"),
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
    includeTaskLocation: true,
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    setupFiles: ["__tests__/patch-function.ts", "__tests__/apply-migrations.ts"],
  },
  run: {
    tasks: {
      // vp tasks, NOT package.json scripts (vp forbids the name collision):
      // both must NEVER cache-replay — root `run.cache: true` caches script
      // tasks, and a replayed "success" would skip real work against live
      // local state (schema after a wiped .wrangler/, demo rows after a wiped
      // D1). wrangler's migration ledger + the seeder's idempotence make real
      // re-runs cheap.
      "db:migrate:local": {
        command: "wrangler d1 migrations apply DB --local",
        cache: false,
      },
      seed: {
        command: "bun scripts/seed.ts",
        cache: false,
      },
    },
  },
});
