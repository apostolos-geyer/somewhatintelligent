// Secrets live in .dev.vars/dashboard, so CI's wrangler-generated types never
// include them — hand-declared on BOTH env surfaces (the generated global `Env`
// and `Cloudflare.Env` each extend the internal base interface independently,
// so one augmentation does not reach the other): handler params typed `Env`,
// and the `import { env } from "cloudflare:workers"` binding (Cloudflare.Env).
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
declare namespace Cloudflare {
  interface Env {
    STRIPE_SECRET_KEY: string;
    STRIPE_WEBHOOK_SIGNING_SECRET: string;
  }
}
