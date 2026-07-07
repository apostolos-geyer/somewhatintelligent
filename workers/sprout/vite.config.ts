import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { defineConfig, type PluginOption } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Worktree-local dev registry, derived from THIS file's location — env vars
// don't survive the portless/vp spawn chain, so every entry point must compute
// the same path itself. Parallel worktrees each get their own registry and
// never cross-bind. MINIFLARE_REGISTRY_PATH is what the vite plugin's
// miniflare actually reads (getDefaultDevRegistryPath); WRANGLER_REGISTRY_PATH
// covers wrangler code paths. Mirrors the wrangler-dev workers' script prefix.
const devRegistry = path.resolve(__dirname, "../../.wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ??= devRegistry;
process.env.WRANGLER_REGISTRY_PATH ??= devRegistry;

const wrangler = parseJsonc(readFileSync(path.resolve(__dirname, "./wrangler.jsonc"), "utf8")) as {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
};

const cfEnv = process.env.CLOUDFLARE_ENV;
const vars: Record<string, string> = {
  ...wrangler.vars,
  ...(cfEnv ? (wrangler.env?.[cfEnv]?.vars ?? {}) : {}),
};

// docs/ops/02 flipped each wrangler.jsonc so its TOP LEVEL is now the STAGING
// section: `vars` above carries staging SPROUT_URL / IDENTITY_URL / AUTH_DOMAIN
// and BRAND_RESOLUTION="path". Those must never bake into a LOCAL DEV client
// bundle. Dev truth lives in ./.dev.vars, which the wrangler-vars define path
// above never reads — so overlay it here.
//   • CLOUDFLARE_ENV set → a real staging/prod build: keep the wrangler vars.
//   • GREENROOM_BUILD=1  → marks any real shipped build (see package.json
//     deploy:staging) so CI's seeded .dev.vars can never leak into a shipped
//     bundle even when CLOUDFLARE_ENV happens to be absent.
//   • missing .dev.vars  → silent no-op (fresh clone / CI typecheck).
// The PORTLESS_URL override below still wins — it stays AFTER this overlay.
if (!cfEnv && !process.env.GREENROOM_BUILD) {
  try {
    for (const line of readFileSync(path.resolve(__dirname, "./.dev.vars"), "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  } catch {
    // no .dev.vars → nothing to overlay
  }
}

// Portless prefixes the dev host with the worktree branch name (see
// `dev` script in package.json), so the wrangler.jsonc dev SPROUT_URL
// (https://sprout.sproutportal.localhost) doesn't match where the worker is
// actually reachable. When PORTLESS_URL is present, prefer it for the
// client bundle so `import.meta.env.SPROUT_URL` matches the live origin.
if (!cfEnv && process.env.PORTLESS_URL) {
  vars.SPROUT_URL = process.env.PORTLESS_URL;
}

// Allowlist wrangler vars that are safe/intended to reach the browser bundle.
// BRAND_RESOLUTION selects the brand-addressing strategy at build time
// (`brand-resolution.ts`): "subdomain" (dev/prod) vs "path" (staging).
const CLIENT_VARS = ["SPROUT_URL", "IDENTITY_URL", "ENVIRONMENT", "BRAND_RESOLUTION"] as const;
// Under vitest there is no build: leave `import.meta.env.*` unset so pure-unit
// modules exercise their runtime fallbacks (e.g. brand-resolution defaults to
// "subdomain"). The wrangler top level is now the STAGING section
// (BRAND_RESOLUTION "path"), so injecting these defines here would wrongly flip
// unit tests into staging mode. Real builds (non-VITEST) still get every var.
const clientDefines = process.env.VITEST
  ? {}
  : Object.fromEntries(
      CLIENT_VARS.filter((k) => vars[k] !== undefined).map((k) => [
        `import.meta.env.${k}`,
        JSON.stringify(vars[k]),
      ]),
    );

// CF plugin's `ssr` environment declares every node built-in as `external`,
// which vitest rejects. Drop CF-specific plugins under VITEST; unit tests
// run as plain node. Mirrors the other apps' (identity/quiz/chat) convention.
function makePlugins(): PluginOption[] {
  if (process.env.VITEST) return [...react()];
  return [
    ...devtools(),
    tailwindcss(),
    // Inspector off by default: every workerd defaults to 9229 and vite's
    // auto-increment probe races when apps (or worktrees) start
    // simultaneously. Set a number here temporarily when you need DevTools.
    ...cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
    ...tanstackStart(),
    ...react(),
  ];
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "#": path.resolve(__dirname, "./src"),
    },
  },
  define: clientDefines,
  server: {
    port: Number(process.env.PORT) || 5173,
    host: "0.0.0.0",
    allowedHosts: [".sproutportal.localhost"],
    // HMR direct to chat's port — bypasses portless+bouncer so the
    // WS upgrade doesn't hit miniflare's `#handleLoopbackUpgrade` bug.
    hmr: {
      host: "localhost",
      clientPort: Number(process.env.PORT) || 5173,
      protocol: "ws",
    },
  },
  plugins: makePlugins(),
  lint: {
    ignorePatterns: ["__tests__/**/*"],
  },
  test: {
    includeTaskLocation: true,
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    environment: "node",
  },
  run: {
    tasks: {
      build: {
        command: "vp build",
        env: ["CLOUDFLARE_ENV", "GREENROOM_BUILD", "NODE_ENV", "VITE_*"],
        input: [
          { auto: true },
          "!**/.output/**",
          "!**/.wrangler/**",
          "!**/dist/**",
          "!**/*.tsbuildinfo",
          "!**/node_modules/.vite/**",
          "!**/node_modules/.vite-temp/**",
        ],
      },
      // vp tasks, NOT package.json scripts (vp forbids the name collision):
      // both must NEVER cache-replay — a replayed "success" would skip real
      // work against live local state (schema after a wiped .wrangler/, demo
      // brands after a wiped D1). See workers/guestlist/vite.config.ts.
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
