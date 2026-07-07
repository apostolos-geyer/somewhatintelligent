/**
 * Guestlist's env shape — explicit interface that travels with the source.
 *
 * Why not use the wrangler-generated global `Env`: TypeScript ambient types
 * (including `Cloudflare.Env` augmentations) are compilation-unit-scoped.
 * Other workers that import any of our public types (the typed RPC client,
 * the Elysia app type, etc.) walk our source into THEIR compilation unit
 * and resolve `env.*` against THEIR `Cloudflare.Env`. With this explicit
 * interface, every consumer sees the same shape regardless of where the
 * source is being compiled.
 *
 * `PROMOTER` references the actual Promoter class via a type-only import
 * so this stays in lockstep with promoter's source signature automatically.
 * `import type` avoids dragging react-email runtime types through.
 *
 * Optional OAuth provider fields are declared `?:` here rather than in a
 * separate `env.d.ts` ambient — same reason as above (ambients don't
 * travel).
 */
import type { Promoter } from "@si/promoter-service";
import type { Roadie } from "@si/roadie-service";

export interface GuestlistEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  BETTER_AUTH_URL: string;
  IDENTITY_URL: string;
  AUTH_DOMAIN: string;
  BETTER_AUTH_SECRET: string;
  EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  FACEBOOK_CLIENT_ID?: string;
  FACEBOOK_CLIENT_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  PROMOTER: Service<typeof Promoter>;
  ROADIE: Service<typeof Roadie>;
}
