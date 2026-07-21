/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by vite.config.ts from wrangler.jsonc (per
  // CLOUDFLARE_ENV) + .dev.vars overlay. See CLIENT_VARS in vite.config.ts.
  // Operator carries no mount prefix, so there is no PUBLIC_BASE here.
  readonly OPERATOR_URL: string;
  readonly ENVIRONMENT: "development" | "staging" | "production";
  // Site's draft-preview endpoint the preview panel form POSTs to (T23).
  readonly SITE_PREVIEW_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// PREVIEW_SIGNING_SECRET is a wrangler SECRET (set via `wrangler secret put`,
// seeded into .dev.vars in dev), so the wrangler-generated types never include
// it — hand-declared on the `cloudflare:workers` env surface the signing server
// fn reads (exec-plan 0004 T23). Never allowlisted into CLIENT_VARS.
declare namespace Cloudflare {
  interface Env {
    PREVIEW_SIGNING_SECRET: string;
  }
}
