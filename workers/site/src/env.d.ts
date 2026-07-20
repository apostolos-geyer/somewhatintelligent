/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

// The adapter injects `App.Locals extends Runtime` (@astrojs/cloudflare
// types.d.ts) via .astro/cloudflare.d.ts. Bindings are typed by the generated
// worker-configuration.d.ts above — regenerate with `bun run types` after
// editing wrangler.jsonc.

// PREVIEW_SIGNING_SECRET lives in .dev.vars/dashboard (a wrangler secret, not a
// wrangler var), so the generated types never include it — hand-declared on the
// `cloudflare:workers` env surface used by `/__preview` (exec-plan 0004 T23).
declare namespace Cloudflare {
  interface Env {
    PREVIEW_SIGNING_SECRET: string;
  }
}

// Dev-only client base for the public Store HTTP API: inlined by
// astro.config.mjs's storeApiBaseDefine on the `dev` command so the browser
// bundle reaches store's own portless origin; absent in shipped builds, where
// the client falls back to the same-origin `/api/store` bouncer mount.
interface ImportMetaEnv {
  readonly PUBLIC_STORE_API_BASE?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
