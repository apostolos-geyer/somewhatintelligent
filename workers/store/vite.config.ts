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
// the same path itself (mirrors workers/identity/vite.config.ts).
const devRegistry = path.resolve(__dirname, "../../.wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ??= devRegistry;
process.env.WRANGLER_REGISTRY_PATH ??= devRegistry;

// The store is VMF-mounted at `/shop` behind bouncer: bouncer strips `/shop`
// inbound (the app serves at its own root) and rewrites asset paths outbound,
// so Vite `base` stays "/" — the built assets are root-relative and bouncer
// scopes them under the mount. The ONLY place the mount prefix lives app-side
// is the CLIENT router `basepath` (src/router.tsx), fed by the single
// `PUBLIC_BASE` config value (wrangler var → client bundle below): "/shop" in
// staging/production, "/" in local dev-direct. Route definitions and every
// <Link>/navigate/redirect stay prefix-free.
const wrangler = parseJsonc(readFileSync(path.resolve(__dirname, "./wrangler.jsonc"), "utf8")) as {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
};

const cfEnv = process.env.CLOUDFLARE_ENV;
const vars: Record<string, string> = {
  ...wrangler.vars,
  ...(cfEnv ? (wrangler.env?.[cfEnv]?.vars ?? {}) : {}),
};

// Dev truth lives in ./.dev.vars (dev-direct URLs, dev attestation key). The
// wrangler-vars path above never reads it, so overlay here unless this is a
// real shipped build (CLOUDFLARE_ENV set, or SI_BUILD=1). Mirrors identity.
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

// Portless prefixes the dev host with the worktree branch name, so prefer its
// live origin for the client bundle when present (mirrors identity).
if (!cfEnv && process.env.PORTLESS_URL) {
  vars.STORE_URL = process.env.PORTLESS_URL;
}

// Allowlist wrangler vars that are safe/intended to reach the browser bundle.
const CLIENT_VARS = [
  "STORE_URL",
  "IDENTITY_URL",
  "AUTH_DOMAIN",
  "ENVIRONMENT",
  "PUBLIC_BASE",
  // Stripe publishable key (pk_…) — client-safe; feeds loadStripe for the
  // embedded Payment Element. The Stripe branch only renders when the
  // server-derived stripeEnabled flag (full stripeConfigured gate) is true.
  "STRIPE_PUBLISHABLE_KEY",
  "STORE_LIVE",
] as const;
const clientDefines = process.env.VITEST
  ? {}
  : Object.fromEntries(
      CLIENT_VARS.filter((k) => vars[k] !== undefined).map((k) => [
        `import.meta.env.${k}`,
        JSON.stringify(vars[k]),
      ]),
    );

// Build-time version stamp, rendered subtly in the footer (src/lib/version.ts).
// Falls back safely when package.json is unreadable or git is unavailable
// (source archive with no .git).
function readAppVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(`${__dirname}/package.json`, "utf8"));
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

// CF plugin's `ssr` environment marks node built-ins external, which vitest
// rejects — drop CF-specific plugins under VITEST (unit tests run as node).
function makePlugins(): PluginOption[] {
  if (process.env.VITEST) return [...react()];
  return [
    ...devtools(),
    tailwindcss(),
    ...cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
    // Unique server-fn base: TanStack Start compiles ONE root-relative base
    // into both the server handler and the client bundle, so under bouncer's
    // vmf mount the hydrated client calls server fns at the APEX (outside
    // `/shop`). `/_sfn/store` is passed through unstripped by bouncer
    // (workers/bouncer/wrangler.jsonc ROUTES) straight to this worker, where
    // it matches the same compiled base. Dev-direct is unaffected (same
    // origin, same path).
    ...tanstackStart({ serverFns: { base: "/_sfn/store" } }),
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
  // Unique assets dir: Vite's own preload-helper and TanStack Start's
  // router-preload manifest resolve dynamically-imported chunk URLs from
  // `import.meta.env.BASE_URL` — a build-time constant, distinct from the
  // runtime PUBLIC_BASE client router basepath described above and equally
  // unable to be mount-aware. Under bouncer's vmf mount those requests land
  // at the bare apex path, so store and identity MUST NOT share `/assets/` —
  // bouncer has no bare-path mount and the collision silently falls through
  // to the `/` → `/shop` catch-all instead of 404ing. A matching bouncer
  // passthrough mount for `/_assets/store` (workers/bouncer/wrangler.jsonc
  // ROUTES) closes the loop, mirroring the `/_sfn/store` server-fn base below.
  build: {
    assetsDir: "_assets/store",
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
      build: {
        command: "vp build",
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
