import { execSync } from "node:child_process";
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
// section: `vars` above carries staging IDENTITY_URL / AUTH_DOMAIN. Those
// must never bake into a LOCAL DEV client bundle. Dev truth lives in
// ./.dev.vars, which the wrangler-vars define path
// above never reads — so overlay it here.
//   • CLOUDFLARE_ENV set → a real staging/prod build: keep the wrangler vars.
//   • SI_BUILD=1  → marks any real shipped build (see package.json
//     deploy:staging) so CI's seeded .dev.vars can never leak into a shipped
//     bundle even when CLOUDFLARE_ENV happens to be absent.
//   • missing .dev.vars  → silent no-op (fresh clone / CI typecheck).
// The PORTLESS_URL override below still wins — it stays AFTER this overlay.
if (!cfEnv && !process.env.SI_BUILD) {
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
// `dev` script in package.json), so the wrangler.jsonc dev IDENTITY_URL
// (https://identity.somewhatintelligent.localhost) doesn't match where the worker is
// actually reachable. When PORTLESS_URL is present, prefer it for the
// client bundle so `import.meta.env.IDENTITY_URL` matches the live origin.
if (!cfEnv && process.env.PORTLESS_URL) {
  vars.IDENTITY_URL = process.env.PORTLESS_URL;
}

// Allowlist wrangler vars that are safe/intended to reach the browser bundle.
const CLIENT_VARS = ["IDENTITY_URL", "AUTH_DOMAIN", "ENVIRONMENT"] as const;
// Under vitest there is no build: leave `import.meta.env.*` unset. The only
// __tests__ file (return-to.test.ts) exercises the env-free core
// (isPlatformHost / resolveReturnTo take the apex as an explicit argument and
// never read import.meta.env — verified: no `import.meta` references in the
// test), so staging defines would only skew, never help. Real builds
// (non-VITEST) still inject every allowlisted var.
const clientDefines = process.env.VITEST
  ? {}
  : Object.fromEntries(
      CLIENT_VARS.filter((k) => vars[k] !== undefined).map((k) => [
        `import.meta.env.${k}`,
        JSON.stringify(vars[k]),
      ]),
    );

// Build-time app version + commit, baked via `define` (the inbox
// vite-config pattern) into BOTH the client bundle (UI footer) and the SSR
// worker bundle (/__version in src/worker.ts). Falls back safely when
// package.json is unreadable or git is unavailable (e.g. a source archive
// with no .git directory).
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, "./package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: __dirname,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

// CF plugin's `ssr` environment declares every node built-in as `external`,
// which vitest rejects. Drop CF-specific plugins under VITEST; the return-to
// unit tests run as plain node.
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
  define: {
    ...clientDefines,
    __APP_VERSION__: JSON.stringify(readAppVersion()),
    __APP_COMMIT__: JSON.stringify(readGitSha()),
  },
  server: {
    port: Number(process.env.PORT) || 5173,
    host: "0.0.0.0",
    allowedHosts: [".somewhatintelligent.localhost"],
    // HMR direct to identity's port — bypasses portless's miniflare loopback bug.
    hmr: { host: "localhost", clientPort: Number(process.env.PORT) || 5173, protocol: "ws" },
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
      "og:build": {
        command: "platform-og build",
        input: [
          { auto: true },
          "og/**/*.{tsx,ts}",
          { pattern: "packages/design/src/fonts/**", base: "workspace" },
          { pattern: "packages/ui/src/components/ui/logo/**", base: "workspace" },
        ],
      },
      build: {
        command: "vp build",
        dependsOn: ["og:build"],
        env: ["CLOUDFLARE_ENV", "SI_BUILD", "NODE_ENV", "VITE_*"],
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
    },
  },
});
