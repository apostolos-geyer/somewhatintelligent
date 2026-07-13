import { readFileSync } from "node:fs";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import babel from "@rolldown/plugin-babel";
import { kCurrentWorker } from "miniflare";
import { defineConfig, type Plugin } from "vite-plus";

// Deploy path: wrangler's `rules: [{ type: "Text", globs: ["**/*.sql"] }]`
// turns the drizzle migration .sql imports into strings. This mirrors that
// for the vite/vitest pipeline.
const sqlAsText: Plugin = {
  name: "sql-as-text",
  enforce: "pre",
  load(id) {
    if (id.endsWith(".sql")) {
      return `export default ${JSON.stringify(readFileSync(id, "utf8"))};`;
    }
    return null;
  },
};

// Test pipeline goes through Vite/Oxc which doesn't yet parse TC39 Stage 3
// decorators (oxc#9170). The deploy pipeline uses wrangler/esbuild which
// handles decorators natively at target=ES2022+. This babel transform
// covers only the test path; the `code: "@"` filter limits it to files
// containing decorator syntax.
export default defineConfig({
  plugins: [
    sqlAsText,
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
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            // Fixed test key material — never used outside miniflare. Two KEK
            // versions are bound so rotation tests can rewrap V1 -> V2.
            VAULT_KEK_V1: "dGVzdC1rZWstdjEtdGVzdC1rZWstdjEtdGVzdC1rZWs=",
            VAULT_KEK_V2: "dGVzdC1rZWstdjItdGVzdC1rZWstdjItdGVzdC1rZWs=",
            VAULT_STATE_HMAC: "dGVzdC1obWFjLXRlc3QtaG1hYy10ZXN0LWhtYWMtMDA=",
            VAULT_GITHUB_CLIENT_ID: "test-github-client-id",
            VAULT_GITHUB_CLIENT_SECRET: "test-github-client-secret",
          },
          // The self-referencing VAULT_RPC binding in wrangler.jsonc points at
          // `si-vault-staging`, but vitest-pool-workers renames the worker
          // under test, so that name never resolves at miniflare boot.
          // Re-point it at the current worker so RPC tests exercise the real
          // Vault entrypoint (and its DO chain) end-to-end.
          serviceBindings: {
            VAULT_RPC: { name: kCurrentWorker, entrypoint: "Vault" },
          },
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
  },
});
