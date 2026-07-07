/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by vite.config.ts from wrangler.jsonc (per CLOUDFLARE_ENV).
  readonly SPROUT_URL: string;
  readonly IDENTITY_URL: string;
  readonly ENVIRONMENT: "development" | "staging" | "production";
  // Brand-addressing strategy — `brand-resolution.ts`. Undefined falls back to
  // "subdomain"; staging injects "path".
  readonly BRAND_RESOLUTION?: "subdomain" | "path";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
