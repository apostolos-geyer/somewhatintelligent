/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by vite.config.ts from wrangler.jsonc (per CLOUDFLARE_ENV).
  readonly IDENTITY_URL: string;
  readonly ENVIRONMENT: "development" | "staging" | "production";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
