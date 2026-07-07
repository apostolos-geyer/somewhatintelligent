/**
 * Guestlist-specific wiring of the platform's canonical auth factory.
 *
 * `createPlatformAuth` (in `@si/auth`) owns the plugin set + session/
 * rateLimit/advanced config. This shim threads guestlist's environment:
 *
 *   - drizzle adapter (with the local schema)
 *   - PROMOTER-backed sendEmail callbacks (correlated via request-context)
 *   - executionContext-backed backgroundTasks handler
 *   - brand info pulled from `@si/config`
 *   - Stripe billing config, gated on STRIPE_SECRET_KEY +
 *     STRIPE_WEBHOOK_SIGNING_SECRET both being present (dormant in every
 *     current env — see packages/stripe/README.md)
 *
 * Kept as a `(env, db) => auth` factory (not a top-level instance) so
 * `auth.codegen.ts` can call it with `process.env` stubs without importing
 * `cloudflare:workers` indirectly.
 */
import {
  createPlatformAuth,
  type CreatePlatformAuthOptions,
  type PlatformAuthSocialProviders,
} from "@si/auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { ulid } from "@si/kit/ids";
import { getRequestId } from "@si/kit/request-context";
import { platformConfig } from "@si/config";
import { stripePrices } from "@si/stripe";

import type { Database } from "./db";
import type { GuestlistEnv } from "./guestlist-env";
import { executionContext } from "./plugins/execution-context";
import { log } from "./log";
import * as schema from "./schema";

// Per-call meta for PROMOTER.send. Reads `requestId` from the active request
// context opened at the guestlist fetch boundary (see ./index.ts), so promoter
// log lines correlate with the inbound HTTP line that triggered the send.
function promoterMeta() {
  return {
    actor: { kind: "service" as const, serviceName: "guestlist" },
    requestId: getRequestId() ?? ulid(),
    callerApp: "guestlist",
  };
}

function buildSocialProviders(env: GuestlistEnv): PlatformAuthSocialProviders {
  return {
    ...(env.GOOGLE_CLIENT_ID &&
      env.GOOGLE_CLIENT_SECRET && {
        google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
      }),
    ...(env.MICROSOFT_CLIENT_ID &&
      env.MICROSOFT_CLIENT_SECRET && {
        microsoft: {
          clientId: env.MICROSOFT_CLIENT_ID,
          clientSecret: env.MICROSOFT_CLIENT_SECRET,
        },
      }),
    ...(env.FACEBOOK_CLIENT_ID &&
      env.FACEBOOK_CLIENT_SECRET && {
        facebook: { clientId: env.FACEBOOK_CLIENT_ID, clientSecret: env.FACEBOOK_CLIENT_SECRET },
      }),
    ...(env.LINKEDIN_CLIENT_ID &&
      env.LINKEDIN_CLIENT_SECRET && {
        linkedin: { clientId: env.LINKEDIN_CLIENT_ID, clientSecret: env.LINKEDIN_CLIENT_SECRET },
      }),
  };
}

// Dormant unless BOTH secrets reach this worker — see the `stripe` field doc
// on `CreatePlatformAuthOptions` (packages/auth/src/server.ts). No env today
// sets either, so this returns `undefined` and the plugin never enters the
// `plugins` array.
function buildStripeOptions(env: GuestlistEnv): CreatePlatformAuthOptions["stripe"] {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SIGNING_SECRET) return undefined;
  return {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SIGNING_SECRET,
    memberPriceId: stripePrices.member_monthly,
  };
}

export function createGuestlistAuth(env: GuestlistEnv, db: Database) {
  return createPlatformAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    authDomain: env.AUTH_DOMAIN,
    identityUrl: env.IDENTITY_URL,
    requireEmailVerification: env.ENVIRONMENT === "production",
    cookiePrefix: platformConfig.cookies.prefix,
    passkeyRpName: platformConfig.auth.passkeyRpName,
    twoFactorIssuer: platformConfig.auth.twoFactorIssuer,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    socialProviders: buildSocialProviders(env),
    stripe: buildStripeOptions(env),
    sendEmail: {
      verification: async ({ user, url }) => {
        await env.PROMOTER.send(
          {
            kind: "verification",
            to: { email: user.email, name: user.name },
            url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      resetPassword: async ({ user, url }) => {
        await env.PROMOTER.send(
          {
            kind: "reset-password",
            to: { email: user.email, name: user.name },
            url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      changeEmail: async ({ user, newEmail, url }) => {
        await env.PROMOTER.send(
          {
            kind: "email-change",
            to: { email: user.email, name: user.name },
            newEmail,
            url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      deleteAccount: async ({ user, url }) => {
        await env.PROMOTER.send(
          {
            kind: "delete-account",
            to: { email: user.email, name: user.name },
            url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      magicLink: async ({ email, url }) => {
        await env.PROMOTER.send(
          {
            kind: "magic-link",
            to: { email },
            url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      invitation: async ({
        email,
        inviterName,
        inviterEmail,
        organizationName,
        role,
        inviteUrl,
      }) => {
        await env.PROMOTER.send(
          {
            kind: "organization-invitation",
            to: { email },
            inviterName,
            inviterEmail,
            organizationName,
            role,
            inviteUrl,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
    },
    backgroundTasks: {
      handler: (promise) => {
        const ctx = executionContext.getStore();
        if (!ctx) return;
        ctx.waitUntil(
          promise.catch((err) => log.warn("auth.bg_task_failed", { error: String(err) })),
        );
      },
    },
  });
}
