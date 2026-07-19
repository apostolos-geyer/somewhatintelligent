/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

// The adapter injects `App.Locals extends Runtime` (@astrojs/cloudflare
// types.d.ts) via .astro/cloudflare.d.ts. Bindings are typed by the generated
// worker-configuration.d.ts above — regenerate with `bun run types` after
// editing wrangler.jsonc.
