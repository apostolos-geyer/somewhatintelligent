import type { D1Migration } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    // The subclass under test — the local Guestlist exports the package RPC
    // surface plus si's own `ensureStripeCustomer` billing method.
    GL_RPC: Service<typeof import("../src/index").Guestlist>;
    ENVIRONMENT: string;
    BETTER_AUTH_URL: string;
    IDENTITY_URL: string;
    AUTH_DOMAIN: string;
    BETTER_AUTH_SECRET: string;
  }
}
