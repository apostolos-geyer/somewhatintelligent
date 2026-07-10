import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { kCurrentWorker } from "miniflare";
import { defineConfig } from "vite-plus";
import { platformDeployConfig } from "@si/config/deploy";

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
          // vitest-pool-workers resolves wrangler.jsonc through the same
          // path as `wrangler dev`, which auto-merges EVERY key of a
          // colocated .dev.vars (gitignored, local-dev) over the checked-in
          // vars — a dev machine's `AUTH_DOMAIN=.somewhatintelligent.localhost`
          // rebuilt trustedOrigins for *.localhost and 403'd every sign-up
          // in this suite (INVALID_ORIGIN). These bindings merge AFTER the
          // wrangler-derived options, re-pinning the staging values the
          // tests are written against; `bun run dev` is untouched.
          bindings: {
            TEST_MIGRATIONS: migrations,
            AUTH_DOMAIN: `.${platformDeployConfig.baseDomain}`,
            BETTER_AUTH_URL: `https://staging.${platformDeployConfig.baseDomain}`,
          },
          // The self-referencing GL_RPC binding in wrangler.jsonc points at
          // `si-guestlist-staging`, but vitest-pool-workers renames the worker
          // under test to its internal runner name, so that service name never
          // resolves at miniflare boot (unlike the real PROMOTER/ROADIE aux
          // workers below). Re-point GL_RPC at the current worker so RPC tests
          // (env.GL_RPC.getSession/searchUsers/admin*/…) exercise the real
          // Guestlist entrypoint on SELF, sharing the test's isolated D1.
          serviceBindings: {
            GL_RPC: { name: kCurrentWorker, entrypoint: "Guestlist" },
          },
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
    setupFiles: ["__tests__/apply-migrations.ts"],
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
      // Materialize the local billing ids module (src/billing.gen.ts) that
      // src/config.ts imports. Offline stub without STRIPE_SECRET_KEY (exits
      // 0). Never cache-replay: billing.gen.ts is gitignored, so a fresh
      // checkout has none and the bundle would otherwise fail to resolve the
      // import — this task regenerates it every build.
      billing: {
        command: "bun scripts/billing.ts fetch",
        cache: false,
      },
      // Any bundling of this worker resolves ./billing.gen; the task graph
      // guarantees it exists first (replaces the old @si/stripe#codegen
      // dependency — that package task no longer exists). `vp run build` is
      // the bundle-validity gate (wrangler dry-run); deploy paths that
      // bundle should run it.
      build: {
        command: "wrangler deploy --dry-run",
        dependsOn: ["billing"],
        cache: false,
      },
    },
  },
});
