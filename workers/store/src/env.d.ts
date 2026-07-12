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
  // Stripe publishable key (pk_…), client-safe by design — feeds loadStripe on
  // the embedded Payment Element. Whether the Stripe branch renders is gated by
  // the server-derived getCheckoutConfig flag (the full stripeConfigured check),
  // not by this var's mere presence.
  readonly STRIPE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Env {
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SIGNING_SECRET: string;
  // STRIPE_EVENTS is NOT hand-declared here: it comes solely from the
  // wrangler-generated worker-configuration.d.ts (present when
  // queues.producers exists, absent after the preview build's
  // `jq 'del(.queues)'`). A hand decl would keep asserting the binding even in
  // that preview build — a green typecheck over a runtime `undefined.send()`.
  // The sole producer call site treats it as optional via a local structural
  // cast — see StripeEventsEnv in src/lib/stripe-webhook.ts.
}

// Build-time version stamp, defined by vite.config.ts (rendered in the footer
// via src/lib/version.ts). Safe fallbacks baked in when git/pkg unavailable.
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
