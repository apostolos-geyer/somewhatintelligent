import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

// Mount the Operator draft-preview endpoint at `/__preview` (RFC-0001 D14 /
// exec-plan T23). The route file lives outside `src/pages/` because Astro
// excludes `_`-prefixed files from file-based routing; injectRoute bypasses
// that so the public URL can be the underscore-prefixed, clearly-internal path.
function operatorPreviewRoute() {
  return {
    name: "operator-preview-route",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        injectRoute({
          pattern: "/__preview",
          entrypoint: "./src/preview-route.astro",
          prerender: false,
        });
      },
    },
  };
}

// Inline the dev-only Store API base into the browser bundle. The value is read
// from `.dev.vars` and injected ONLY on the `dev` command, so shipped builds
// (`build`/`preview`) omit the define and the client falls back to the
// same-origin `/api/store` bouncer mount by construction.
function storeApiBaseDefine() {
  return {
    name: "store-api-base-define",
    hooks: {
      "astro:config:setup": ({ command, updateConfig }) => {
        if (command !== "dev") return;
        const devVarsPath = resolve(dirname(fileURLToPath(import.meta.url)), ".dev.vars");
        let base = "";
        try {
          const line = readFileSync(devVarsPath, "utf8")
            .split("\n")
            .find((l) => l.startsWith("STORE_API_BASE="));
          if (line) base = line.slice("STORE_API_BASE=".length).trim();
        } catch {
          /* no .dev.vars yet — leave undefined, client uses same-origin */
        }
        if (base) {
          updateConfig({
            vite: {
              define: {
                "import.meta.env.PUBLIC_STORE_API_BASE": JSON.stringify(base),
              },
            },
          });
        }
      },
    },
  };
}

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // The site ships no astro:assets images — passthrough keeps the deploy
    // binding inventory to the two read-only service bindings (INV-SITE-1).
    imageService: "passthrough",
  }),
  integrations: [operatorPreviewRoute(), storeApiBaseDefine(), react()],
  // Astro's dev server accepts the portless `site.somewhatintelligent.localhost`
  // Host header so Site shares a site with `store.somewhatintelligent.localhost`
  // (SameSite=Lax session cookie flow + devDomain-derived CORS).
  vite: { server: { allowedHosts: [".somewhatintelligent.localhost"] } },
  // The site has no same-origin state-changing forms; its only POST endpoint is
  // `/__preview`, authenticated by an HMAC (not by Origin) and deliberately
  // posted cross-origin from the Operator console. Astro's default cross-site
  // form-POST guard would reject that legitimate submission, so it is disabled
  // site-wide (T23).
  security: {
    checkOrigin: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4321,
  },
});
