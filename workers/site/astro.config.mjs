import cloudflare from "@astrojs/cloudflare";
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

export default defineConfig({
  output: "server",
  adapter: cloudflare({
    // The site ships no astro:assets images — passthrough keeps the deploy
    // binding inventory to the two read-only service bindings (INV-SITE-1).
    imageService: "passthrough",
  }),
  integrations: [operatorPreviewRoute()],
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
