/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Injected at build time by vite.config.ts from wrangler.jsonc (per
  // CLOUDFLARE_ENV) + .dev.vars overlay. See CLIENT_VARS in vite.config.ts.
  readonly STORE_URL: string;
  readonly IDENTITY_URL: string;
  readonly AUTH_DOMAIN: string;
  readonly ENVIRONMENT: "development" | "staging" | "production";
  // THE single source of the client-only router basepath (the `/shop` mount,
  // or "/" in dev-direct). See src/lib/basepath.ts + src/router.tsx.
  readonly PUBLIC_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Build-time version stamp, defined by vite.config.ts (rendered in the footer
// via src/lib/version.ts). Safe fallbacks baked in when git/pkg unavailable.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
