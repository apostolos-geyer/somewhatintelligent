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
// don't survive the vp spawn chain, so the entry point computes the path itself
// (mirrors workers/store/vite.config.ts).
const devRegistry = path.resolve(__dirname, "../../.wrangler/dev-registry");
process.env.MINIFLARE_REGISTRY_PATH ??= devRegistry;
process.env.WRANGLER_REGISTRY_PATH ??= devRegistry;

// Operator deploys DIRECTLY on desk.* with its own custom hostname (RFC-0001
// D6) — NOT vmf-mounted behind bouncer. There is no mount prefix, so none of
// store's PUBLIC_BASE / mount-rewrite / unique-assetsDir / non-root server-fn
// base machinery applies here: route definitions live at the app root and the
// default TanStack Start server-fn base is correct.
const wrangler = parseJsonc(readFileSync(path.resolve(__dirname, "./wrangler.jsonc"), "utf8")) as {
  vars?: Record<string, string>;
  env?: Record<string, { vars?: Record<string, string> }>;
};

const cfEnv = process.env.CLOUDFLARE_ENV;
const vars: Record<string, string> = {
  ...wrangler.vars,
  ...(cfEnv ? (wrangler.env?.[cfEnv]?.vars ?? {}) : {}),
};

// Dev truth lives in ./.dev.vars (ENVIRONMENT=development + the fixed
// DEV_OPERATOR actor). The wrangler-vars path above never reads it, so overlay
// here unless this is a real shipped build (CLOUDFLARE_ENV set, or SI_BUILD=1).
// Mirrors store.
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

// Allowlist wrangler vars that are safe/intended to reach the browser bundle.
// DEV_OPERATOR / POLICY_AUD / TEAM_DOMAIN are server secrets and never listed.
const CLIENT_VARS = ["OPERATOR_URL", "ENVIRONMENT"] as const;
const clientDefines = process.env.VITEST
  ? {}
  : Object.fromEntries(
      CLIENT_VARS.filter((k) => vars[k] !== undefined).map((k) => [
        `import.meta.env.${k}`,
        JSON.stringify(vars[k]),
      ]),
    );

// CF plugin's `ssr` environment marks node built-ins external, which vitest
// rejects — drop CF-specific plugins under VITEST (unit tests run as node).
function makePlugins(): PluginOption[] {
  if (process.env.VITEST) return [...react()];
  return [
    ...devtools(),
    tailwindcss(),
    ...cloudflare({ viteEnvironment: { name: "ssr" }, inspectorPort: false }),
    ...tanstackStart(),
    ...react(),
  ];
}

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Verified chain: start.ts imports createLoggingFunctionMiddleware /
      // createRequestLogger from the @somewhatintelligent/kit/react-start
      // BARREL. Vite dev serves unbundled ESM with no tree-shaking, so any
      // import from that barrel forces the browser to fetch every sibling
      // module in it too — including service-clients.ts / dev-envelope.ts /
      // platform-start-app.ts, which import @somewhatintelligent/auth ->
      // @better-auth/passkey -> @simplewebauthn/server -> @peculiar/x509 ->
      // pvtsutils/asn1js. Those two packages ship a CJS build (`main`) that
      // Vite's cjs-module-lexer can't fully statically scan (tslib's
      // __exportStar-emitted named exports aren't detected), so the dev
      // client crashes with "does not provide an export named
      // 'BufferSourceConverter'" the moment that chain loads client-side.
      // Aliasing straight to each package's ESM build sidesteps the CJS
      // scan entirely — confirmed present in both compiled ESM files.
      pvtsutils: path.resolve(__dirname, "../../node_modules/pvtsutils/build/index.es.js"),
      asn1js: path.resolve(__dirname, "../../node_modules/asn1js/build/index.es.js"),
    },
  },
  define: clientDefines,
  server: {
    port: Number(process.env.PORT) || 8792,
    host: "0.0.0.0",
    allowedHosts: [".somewhatintelligent.localhost"],
    hmr: { host: "localhost", clientPort: Number(process.env.PORT) || 8792, protocol: "ws" },
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
    },
  },
});
