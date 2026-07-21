/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />

import "../../worker-configuration";

// The test-only migrations bundle vitest.pool.config.ts installs via Miniflare.
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS?: import("cloudflare:test").D1Migration[];
    }
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Cloudflare.Env {}
}
