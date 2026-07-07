import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJsonc } from "jsonc-parser";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

import cloudflare from "@astrojs/cloudflare";

// Mirror the vars-to-client pattern used by the other platform apps
// so `import.meta.env.*_URL` resolves inside Astro islands at build time.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wrangler = parseJsonc(readFileSync(path.resolve(__dirname, "./wrangler.jsonc"), "utf8"));
const cfEnv = process.env.CLOUDFLARE_ENV;
const vars = {
  ...wrangler.vars,
  ...(cfEnv ? (wrangler.env?.[cfEnv]?.vars ?? {}) : {}),
};

// docs/ops/02 flipped wrangler.jsonc so its TOP LEVEL is now the STAGING
// section: `vars` above carries staging MARKETING_URL / IDENTITY_URL. Those
// must never bake into a LOCAL DEV client bundle. Dev truth lives in ./.dev.vars
// (which the wrangler-vars define path above never reads) — so overlay it here.
//   • CLOUDFLARE_ENV set → a real staging/prod build: keep the wrangler vars.
//   • GREENROOM_BUILD=1  → marks any real shipped build (see package.json
//     deploy:staging) so CI's seeded .dev.vars can never leak into a shipped
//     bundle even when CLOUDFLARE_ENV happens to be absent.
//   • missing .dev.vars  → silent no-op (marketing ships none today; fresh
//     clone / CI typecheck).
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

const CLIENT_VARS = ["MARKETING_URL", "IDENTITY_URL"];
const clientDefines = Object.fromEntries(
  CLIENT_VARS.filter((k) => vars[k] !== undefined).map((k) => [
    `import.meta.env.${k}`,
    JSON.stringify(vars[k]),
  ]),
);

// https://astro.build/config
export default defineConfig({
  site: "https://sproutportal.ca",
  base: "/",
  integrations: [react()],

  // Opt out of the Cloudflare adapter's auto-KV Sessions binding.
  // marketing has no session state; memory driver avoids provisioning a SESSION KV namespace.
  session: { driver: "memory" },

  server: {
    port: Number(process.env.PORT) || 4321,
    host: process.env.HOST || "0.0.0.0",
  },

  vite: {
    plugins: [...tailwindcss()],
    define: clientDefines,
    // Portless proxies via *.sproutportal.localhost; Vite's dev server
    // rejects host headers outside its allowlist unless told otherwise.
    server: {
      allowedHosts: [".sproutportal.localhost"],
    },
    optimizeDeps: {
      include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
    },
    resolve: {
      dedupe: ["react", "react-dom"],
    },
  },

  ssr: { noExternal: ["@greenroom/ui", "@greenroom/design", "@greenroom/config"] },
  adapter: cloudflare(),
});
