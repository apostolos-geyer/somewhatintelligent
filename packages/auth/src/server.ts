/**
 * Platform auth factory.
 *
 * Wraps `betterAuth` from `better-auth/minimal` with the platform's canonical
 * plugin set + session/rateLimit/advanced config. Every per-fork or per-env
 * value is passed in via opts — this module deliberately imports nothing
 * from `cloudflare:workers`, `drizzle-orm`, or `@si/config`. Callers
 * thread those in.
 *
 * Consumers:
 *   - guestlist wires drizzleAdapter + PROMOTER + the executionContext-backed
 *     background-task handler in `workers/guestlist/src/auth-config.ts`.
 *   - guestlist's `auth.codegen.ts` calls the same shim with `process.env`
 *     stubs so `bunx auth generate` can introspect the plugin set without
 *     touching cloudflare:workers internals.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth/minimal";
import {
  admin,
  bearer,
  deviceAuthorization,
  jwt,
  magicLink,
  organization,
  twoFactor,
  username,
} from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc,
} from "better-auth/plugins/organization/access";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passkey } from "@better-auth/passkey";
import { apiKey } from "@better-auth/api-key";

// Platform-wide organization access control — extends BA's default statements
// with platform-specific resources (theme, billing, scim). Roles stay
// hand-written rather than spreading `defaultRoles` so the AC surface is
// auditable in one place and apps can call `hasOrgPermission({
// permissions: { theme: ["update"] } })` against named statements.
//
// See docs/MULTI-TENANCY.md §4.1 for the canonical statement set + role
// mapping. Dynamic AC is intentionally deferred (§6.5) — start with three
// static roles; org admins can't define their own until a customer asks.
const orgStatement = {
  ...defaultStatements,
  theme: ["update"],
  billing: ["read", "update"],
  scim: ["read", "configure"],
} as const;

const orgAc = createAccessControl(orgStatement);

const orgMemberRole = orgAc.newRole({ ...memberAc.statements });
const orgAdminRole = orgAc.newRole({
  ...adminAc.statements,
  theme: ["update"],
  billing: ["read"],
});
const orgOwnerRole = orgAc.newRole({
  ...ownerAc.statements,
  theme: ["update"],
  billing: ["read", "update"],
  scim: ["read", "configure"],
});

export interface PlatformAuthSendEmail {
  verification: (params: { user: { email: string; name: string }; url: string }) => Promise<void>;
  resetPassword: (params: { user: { email: string; name: string }; url: string }) => Promise<void>;
  changeEmail: (params: {
    user: { email: string; name: string };
    newEmail: string;
    url: string;
  }) => Promise<void>;
  deleteAccount: (params: { user: { email: string; name: string }; url: string }) => Promise<void>;
  magicLink: (params: { email: string; url: string }) => Promise<void>;
  /**
   * Sent when a member is invited to an organization via the BA
   * organization plugin. Payload mirrors BA's sendInvitationEmail data
   * shape (id, email, inviter, organization) so the callback can
   * package it for promoter without losing fidelity.
   */
  invitation: (data: {
    invitationId: string;
    email: string;
    inviterName: string;
    inviterEmail: string;
    organizationName: string;
    role: string;
    inviteUrl: string;
  }) => Promise<void>;
}

export interface PlatformAuthSocialProviders {
  google?: { clientId: string; clientSecret: string };
  microsoft?: { clientId: string; clientSecret: string };
  facebook?: { clientId: string; clientSecret: string };
  linkedin?: { clientId: string; clientSecret: string };
}

export interface CreatePlatformAuthOptions {
  /** Better Auth base URL — the canonical user-facing origin (identity host). */
  baseURL: string;
  /** HS256 cookie/JWT signing secret. Shared across services for cookie-cache decode. */
  secret: string;
  /** Cookie `Domain` attribute — `.{baseDomain}` for cross-subdomain session sharing. */
  authDomain: string;
  /** Origin for oauthProvider's loginPage/consentPage (identity SSR routes). */
  identityUrl: string;
  /** Whether sign-in requires a verified email. Caller decides per env. */
  requireEmailVerification: boolean;
  /** Cookie name prefix (e.g. `"platform"`); reused by the session-reader. */
  cookiePrefix: string;
  /** Friendly app name shown to the WebAuthn user agent during passkey ceremonies. */
  passkeyRpName: string;
  /** Issuer string surfaced by authenticator apps during 2FA enrollment. */
  twoFactorIssuer: string;
  /**
   * Adapter for Better Auth's database layer. Caller constructs it
   * (drizzleAdapter, prismaAdapter, etc.) and passes the opaque shape in —
   * this module knows nothing about ORM choice or schema location.
   */
  database: BetterAuthOptions["database"];
  /** Sparse map of OAuth providers — only providers with creds present are enabled. */
  socialProviders?: PlatformAuthSocialProviders;
  /** Side-channel email senders. Caller wires the transport (PROMOTER, Resend, etc.). */
  sendEmail: PlatformAuthSendEmail;
  /** Optional background-task handler (ctx.waitUntil etc.). No-op when omitted. */
  backgroundTasks?: { handler: (promise: Promise<unknown>) => void };
}

export function createPlatformAuth(opts: CreatePlatformAuthOptions) {
  return betterAuth({
    baseURL: opts.baseURL,
    database: opts.database,
    basePath: "/api/auth",
    disabledPaths: ["/token"],
    secret: opts.secret,

    user: {
      changeEmail: {
        enabled: true,
        sendChangeEmailConfirmation: ({ user, newEmail, url }) =>
          opts.sendEmail.changeEmail({ user, newEmail, url }),
      },
      deleteUser: {
        enabled: true,
        sendDeleteAccountVerification: ({ user, url }) =>
          opts.sendEmail.deleteAccount({ user, url }),
      },
    },

    account: {
      accountLinking: {
        enabled: true,
        allowDifferentEmails: true,
        trustedProviders: ["google", "microsoft", "facebook", "linkedin"],
      },
    },

    socialProviders: {
      ...(opts.socialProviders?.google && { google: opts.socialProviders.google }),
      ...(opts.socialProviders?.microsoft && { microsoft: opts.socialProviders.microsoft }),
      ...(opts.socialProviders?.facebook && { facebook: opts.socialProviders.facebook }),
      ...(opts.socialProviders?.linkedin && { linkedin: opts.socialProviders.linkedin }),
    },

    plugins: [
      username(),
      jwt({ disableSettingJwtHeader: true }),
      admin({
        defaultRole: "user",
        impersonationSessionDuration: 60 * 60,
      }),
      twoFactor({
        issuer: opts.twoFactorIssuer,
        otpOptions: { period: 30, digits: 6 },
      }),
      bearer(),
      passkey({
        // AUTH_DOMAIN has a leading dot (cookie-domain convention); WebAuthn
        // rpID wants the bare apex so it's a valid registrable suffix of
        // every subdomain.
        rpID: opts.authDomain.replace(/^\./, ""),
        rpName: opts.passkeyRpName,
      }),
      // schema: undefined is required by zod 4.4 (key must be present); value
      // stays undefined so BA's mergeSchema applies the plugin defaults.
      deviceAuthorization({ verificationUri: "/device", schema: undefined }),
      apiKey(),
      magicLink({
        sendMagicLink: ({ email, url }) => opts.sendEmail.magicLink({ email, url }),
      }),
      oauthProvider({
        loginPage: `${opts.identityUrl}/sign-in`,
        consentPage: `${opts.identityUrl}/consent`,
        scopes: ["openid", "profile", "email", "offline_access"],
        allowPublicClientPrelogin: true,
        customUserInfoClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
        customIdTokenClaims: ({ user }) => ({
          role: (user as Record<string, unknown>).role ?? "user",
        }),
        silenceWarnings: { oauthAuthServerConfig: true },
      }),
      // Organization plugin — multi-tenancy primitive. Adds the
      // organization/member/invitation tables + the
      // `/api/auth/organization/*` route surface (Surface A in
      // docs/MULTI-TENANCY.md §6.1). Operators reach into orgs via the
      // custom `/admin/orgs/*` routes on guestlist (Surface B, §6.2),
      // which call `auth.api.*` server-side without session headers per
      // §4.4.
      organization({
        ac: orgAc,
        roles: {
          owner: orgOwnerRole,
          admin: orgAdminRole,
          member: orgMemberRole,
        },
        creatorRole: "owner",
        // v1 is operator-provisioned. End-users cannot self-create orgs
        // through identity's normal UI. Operator-only `/admin/orgs/create`
        // (O-1) bypasses this by calling the BA server API without session
        // headers and passing `userId` explicitly.
        allowUserToCreateOrganization: false,
        requireEmailVerificationOnInvitation: true,
        invitationExpiresIn: 60 * 60 * 24 * 7, // 7 days
        cancelPendingInvitationsOnReInvite: true,
        // Wired through `opts.sendEmail.invitation` (guestlist threads
        // PROMOTER.send behind it). The data shape mirrors BA's documented
        // contract — `{ id, role, email, organization, inviter: { user } }`
        // — and we project it into the platform-internal `invitation`
        // callback so the caller doesn't need to depend on BA's exact
        // record types. The accept URL is constructed here so the
        // identity-host origin lives in one place (passed in as
        // `opts.identityUrl`).
        sendInvitationEmail: async (data) => {
          await opts.sendEmail.invitation({
            invitationId: data.id,
            email: data.email,
            inviterName: data.inviter.user.name,
            inviterEmail: data.inviter.user.email,
            organizationName: data.organization.name,
            role: data.role,
            inviteUrl: `${opts.identityUrl}/orgs/accept/${data.id}`,
          });
        },
      }),
    ],

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: opts.requireEmailVerification,
      sendResetPassword: ({ user, url }) => opts.sendEmail.resetPassword({ user, url }),
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: ({ user, url }) => opts.sendEmail.verification({ user, url }),
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      storeSessionInDatabase: true,
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
        strategy: "jwt",
      },
    },

    // Auto-activate org for single-membership users (docs/MULTI-TENANCY.md
    // §4.2). The hook reads memberships through BA's DB adapter exposed
    // on the endpoint context (`ctx.context.adapter.findMany`) so the
    // lookup uses the same database the org plugin is writing through —
    // no need to thread the caller's drizzle instance into this module.
    //
    // Users with zero memberships, or two-or-more, keep
    // `activeOrganizationId = null` until they explicitly call
    // `auth.organization.setActive(...)`. Users with exactly one
    // membership get it stamped onto every freshly minted session so
    // apps don't have to chase a separate `setActive` hop after sign-in.
    databaseHooks: {
      session: {
        create: {
          before: async (session, ctx) => {
            if (!ctx) return { data: session };
            try {
              const memberships = await ctx.context.adapter.findMany<{
                organizationId: string;
              }>({
                model: "member",
                where: [{ field: "userId", value: session.userId }],
                limit: 2,
              });
              if (memberships.length === 1) {
                return {
                  data: {
                    ...session,
                    activeOrganizationId: memberships[0]!.organizationId,
                  },
                };
              }
            } catch {
              // Member table may not exist (pre-migration); fall through
              // and create the session unchanged so sign-in still works.
            }
            return { data: session };
          },
        },
      },
    },

    rateLimit: {
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 10, max: 3 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/two-factor/*": { window: 10, max: 3 },
      },
    },

    advanced: {
      crossSubDomainCookies: {
        enabled: true,
        domain: opts.authDomain,
      },
      cookiePrefix: opts.cookiePrefix,
      ipAddress: {
        ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
      },
      ...(opts.backgroundTasks && {
        backgroundTasks: { handler: opts.backgroundTasks.handler },
      }),
    },

    trustedOrigins: (() => {
      const apex = opts.authDomain.replace(/^\./, "");
      return [`https://*.${apex}`, `http://*.${apex}`];
    })(),
  });
}
