import type { D1Migration } from "cloudflare:test";
import type { GuestlistRpc } from "@somewhatintelligent/guestlist";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
    GL_RPC: Service<GuestlistRpc>;
    ENVIRONMENT: string;
    BETTER_AUTH_URL: string;
    IDENTITY_URL: string;
    AUTH_DOMAIN: string;
    BETTER_AUTH_SECRET: string;
  }
}
