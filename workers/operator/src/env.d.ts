/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by vite.config.ts from wrangler.jsonc (per
  // CLOUDFLARE_ENV) + .dev.vars overlay. See CLIENT_VARS in vite.config.ts.
  // Operator carries no mount prefix, so there is no PUBLIC_BASE here.
  readonly OPERATOR_URL: string;
  readonly ENVIRONMENT: "development" | "staging" | "production";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
