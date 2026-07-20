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
