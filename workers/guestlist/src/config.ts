/**
 * The consumer-owned guestlist config — the entire knob surface
 * `createGuestlist` (@somewhatintelligent/guestlist) takes. Brand values
 * come from `@si/config` (which stays in si); email renders through
 * PROMOTER and avatars through ROADIE, both injected as env-receiving
 * factories.
 *
 * The SAME object feeds both `src/index.ts` (the running worker) and
 * `guestlist.codegen.ts` (the schema-generation instance), so billing
 * presence, plugin surface, and schema stay consistent by construction.
 */
import {
  defineEmailHandlers,
  type GuestlistConfig,
  type GuestlistEnv as PackageGuestlistEnv,
} from "@somewhatintelligent/guestlist";
import { getRequestId } from "@somewhatintelligent/kit/request-context";
import { ulid } from "@somewhatintelligent/kit/ids";
import { platformConfig } from "@si/config/brand";
import { platformDeployConfig } from "@si/config/deploy";
import type { Promoter } from "@si/promoter-service";
import type { Roadie } from "@si/roadie-service";
import * as schema from "./schema.gen";
import { makeRoadieBlobStore } from "./blobs.roadie";

/**
 * si's env shape: the package's required bindings/vars plus the ones our
 * injected capabilities read — EMAIL_FROM + the PROMOTER/ROADIE service
 * bindings. `import type` on the entrypoint classes keeps this in lockstep
 * with their signatures without dragging their runtime in.
 */
export interface GuestlistEnv extends PackageGuestlistEnv {
  EMAIL_FROM: string;
  PROMOTER: Service<typeof Promoter>;
  ROADIE: Service<typeof Roadie>;
}

// Per-call meta for PROMOTER.send. Reads `requestId` from the active
// request context (opened at guestlist's fetch boundary inside the
// package) so promoter's log lines correlate with the inbound request that
// triggered the send; falls back to a fresh ulid when there is none.
function promoterMeta() {
  return {
    actor: { kind: "service" as const, serviceName: "guestlist" },
    requestId: getRequestId() ?? ulid(),
    callerApp: "guestlist",
  };
}

export const guestlistConfig: GuestlistConfig<GuestlistEnv> = {
  schema,
  cookiePrefix: platformConfig.cookies.prefix,
  passkeyRpName: platformConfig.auth.passkeyRpName,
  twoFactorIssuer: platformConfig.auth.twoFactorIssuer,
  corsDomains: [platformDeployConfig.baseDomain, platformDeployConfig.devDomain],
  // Exhaustive per-kind handlers (defineEmailHandlers is exhaustive-by-type,
  // so a new package email kind is a compile error). Each maps the
  // GuestlistEmail event onto PROMOTER's SendInput union.
  sendEmail: (env) =>
    defineEmailHandlers({
      verification: async (msg) => {
        await env.PROMOTER.send(
          { kind: "verification", to: msg.to, url: msg.url, from: env.EMAIL_FROM },
          promoterMeta(),
        );
      },
      "reset-password": async (msg) => {
        await env.PROMOTER.send(
          { kind: "reset-password", to: msg.to, url: msg.url, from: env.EMAIL_FROM },
          promoterMeta(),
        );
      },
      "email-change": async (msg) => {
        await env.PROMOTER.send(
          {
            kind: "email-change",
            to: msg.to,
            url: msg.url,
            newEmail: msg.newEmail,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
      "delete-account": async (msg) => {
        await env.PROMOTER.send(
          { kind: "delete-account", to: msg.to, url: msg.url, from: env.EMAIL_FROM },
          promoterMeta(),
        );
      },
      "magic-link": async (msg) => {
        await env.PROMOTER.send(
          { kind: "magic-link", to: msg.to, url: msg.url, from: env.EMAIL_FROM },
          promoterMeta(),
        );
      },
      "org-invitation": async (msg) => {
        await env.PROMOTER.send(
          {
            kind: "organization-invitation",
            to: msg.to,
            inviterName: msg.inviter.name,
            inviterEmail: msg.inviter.email,
            organizationName: msg.organizationName,
            role: msg.role,
            inviteUrl: msg.url,
            from: env.EMAIL_FROM,
          },
          promoterMeta(),
        );
      },
    }),
  blobs: (env) => makeRoadieBlobStore(env),
  // Stock org access (si has no custom roles). Admin/session/rateLimit stay
  // at the platform defaults.
  //
  // billing PRESENCE — not plan count — is what keeps the `subscription`
  // table + `user.stripe_customer_id` in the generated schema; dropping it
  // would make drizzle propose DROPPING the live subscription table. Empty
  // plans = schema provisioned, no tiers declared yet: the BA stripe plugin
  // stays dormant until plans are declared AND STRIPE_* secrets reach the
  // env. When tiers land, declare them in ./billing.catalog.ts, sync, and
  // list them here from ./billing.gen.
  //
  // organization.enabled is ALSO schema-affecting: it models
  // `organization.stripe_customer_id`, which the live DB has carried since
  // migration 0004 — without it the generated schema diverges from the
  // journal and arms a destructive column-drop on the next drizzle generate.
  billing: { plans: [], organization: { enabled: true } },
};
