/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />

import "../worker-configuration";

// Extend the wrangler-generated Cloudflare.Env with the secret bindings that
// vite.config.ts installs via Miniflare (secrets never appear in
// wrangler.jsonc vars, so `wrangler types` can't know them).
declare global {
  namespace Cloudflare {
    interface Env {
      VAULT_KEK_V1: string;
      VAULT_KEK_V2: string;
      VAULT_STATE_HMAC: string;
      VAULT_GITHUB_CLIENT_ID: string;
      VAULT_GITHUB_CLIENT_SECRET: string;
    }
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Cloudflare.Env {}
}
