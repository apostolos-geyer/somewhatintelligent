import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vite-plus";
// Subpath (not the barrel): deploy.ts is a standalone object, so vite's Node
// ESM config loader resolves it without choking on index.ts's extensionless
// re-exports. The per-file type-checker may phantom this import; tsgo/the
// workspace check resolve it via the package's exports map.
import { platformDeployConfig } from "@greenroom/config/deploy";

const mock = (name: string) => path.join(__dirname, `__tests__/mocks/${name}.js`);

// Worker-name prefix: the checked-in wrangler.jsonc (top level = staging)
// resolves service bindings to `<prefix>-<service>-staging` (e.g.
// sprout-guestlist-staging), so the stub workers below must carry the same
// prefix AND `-staging` suffix or miniflare can't bind them at boot.
// Config-derived so a rebrand can't restale the prefix.
const wp = platformDeployConfig.workerPrefix ? `${platformDeployConfig.workerPrefix}-` : "";

export default defineConfig({
  plugins: [
    cloudflareTest(() => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        serviceBindings: {
          // proxy.test.ts routes its fixtures through the `WWW` binding; bind it
          // to the `www` stub worker (declared below) so `env.WWW` resolves to a
          // Fetcher. Without this, dispatch throws "route binding WWW is not a
          // bound Fetcher" — WWW is never a real wrangler.jsonc service.
          WWW: "www",
          APP1: "worker-a",
          APP2: "worker-b",
        },
        // Service bindings declared in wrangler.jsonc need a worker to resolve
        // to at miniflare boot time. guestlist gets a specialized stub (the
        // deliberate-throw branch + /api/json|/api/redirect branches the proxy
        // specs assert against); the app bindings (identity/sprout) share
        // one generic stub — bouncer's dispatch/proxy logic doesn't care which app
        // responds. Names carry the worker prefix + `-staging` suffix so they match
        // the `<prefix>-<service>-staging` service-binding targets in wrangler.jsonc.
        workers: [
          { name: `${wp}guestlist-staging`, modules: true, scriptPath: mock("guestlist-stub") },
          { name: `${wp}identity-staging`, modules: true, scriptPath: mock("app-stub") },
          { name: `${wp}sprout-staging`, modules: true, scriptPath: mock("app-stub") },
          // Test-only fixtures bound via the serviceBindings map above (not real
          // wrangler.jsonc services): the routing/proxy/template-parity specs
          // dispatch through them, so they keep fixed, unprefixed names.
          { name: "www", modules: true, scriptPath: mock("www-stub") },
          { name: "worker-a", modules: true, scriptPath: mock("worker-a-stub") },
          { name: "worker-b", modules: true, scriptPath: mock("worker-b-stub") },
        ],
      },
    })),
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
