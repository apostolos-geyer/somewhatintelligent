/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />

import "../worker-configuration";

// Extend the wrangler-generated Cloudflare.Env with the test-only binding
// that vite.config.ts installs via Miniflare. Declared in a module context
// (env.d.ts is a module because of the side-effect import above), so we use
// `declare global` to hit the ambient namespace.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    }
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Cloudflare.Env {}
}
