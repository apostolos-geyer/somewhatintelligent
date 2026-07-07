import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite-plus";

// Test pipeline goes through Vite/Oxc which doesn't yet parse TC39 Stage 3
// decorators (oxc#9170). The deploy pipeline uses wrangler/esbuild which
// handles decorators natively at target=ES2022+. This babel transform
// covers only the test path; the `code: "@"` filter limits it to files
// containing decorator syntax.
export default defineConfig({
  plugins: [
    babel({
      presets: [
        {
          preset: () => ({
            plugins: [["@babel/plugin-proposal-decorators", { version: "2023-11" }]],
          }),
          rolldown: { filter: { code: "@" } },
        },
      ],
    }) as never,
    cloudflareTest(async () => {
      const migrationsPath = path.join(__dirname, "migrations");
      const migrations = await readD1Migrations(migrationsPath);
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            // Fake SigV4 creds — miniflare doesn't validate SigV4 against R2.
            // They're needed only so aws4fetch's AwsClient can construct;
            // signed-header enforcement and presigned-URL round-trips are
            // manual-integration tests against real R2 (documented gap).
            S3_ACCESS_KEY_ID: "test-access-key",
            S3_SECRET_ACCESS_KEY: "test-secret-key",
          },
          r2Buckets: ["BLOBS"],
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
    setupFiles: ["__tests__/apply-migrations.ts"],
  },
  run: {
    tasks: {
      // NEVER cache-replay a migration: root `run.cache: true` caches script
      // tasks, and a replayed "success" would skip actually applying schema to
      // the local D1 (e.g. after a wiped .wrangler/). wrangler's own migration
      // ledger makes real re-runs cheap + idempotent.
      "db:migrate:local": {
        command: "wrangler d1 migrations apply DB --local",
        cache: false,
      },
    },
  },
});
