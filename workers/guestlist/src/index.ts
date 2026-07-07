import { Elysia, t } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { cors } from "@elysiajs/cors";
import {
  oauthProviderOpenIdConfigMetadata,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider";
import { and, count, desc, eq, inArray, like, or } from "drizzle-orm";
import { extractRequestId, getRequestId, withRequestContext } from "@si/kit/request-context";
import { handleVersionRequest } from "@si/kit/version";
import { ulid } from "@si/kit/ids";
import { createRoadieClient } from "@si/roadie-service/client";
import { platformDeployConfig } from "@si/config";

// @elysiajs/cors tests each RegExp against the full `Origin` header value
// (scheme + host, e.g. "https://somewhatintelligent.ca"), not just the
// hostname — so the pattern must be anchored start-to-end and account for
// the bare apex itself, not only its subdomains. A suffix-only
// `\.${domain}$` pattern requires a literal "." immediately before the
// domain, which every subdomain has but the bare apex does not (the
// character before it is "/" from "https://"), silently locking real
// top-level-origin requests (e.g. a same-page fetch/XHR from
// "https://somewhatintelligent.ca") out of CORS in production.
const escapeDot = (d: string) => d.replace(/\./g, "\\.");
const originPattern = (domain: string) =>
  new RegExp(`^https?://([a-z0-9-]+\\.)*${escapeDot(domain)}$`);
const corsOrigins = [
  originPattern(platformDeployConfig.baseDomain),
  originPattern(platformDeployConfig.devDomain),
];

import { env } from "./env";
import { auth } from "./auth";
import { db } from "./db";

import {
  user,
  session,
  apikey,
  oauthClient,
  oauthAccessToken,
  oauthConsent,
  organization,
  member,
  invitation,
} from "./schema";
import { executionContext, withExecutionContext } from "./plugins/execution-context";
import { emitHttp } from "./log";

// Roadie SDK for avatar storage. Every roadie call carries an explicit actor
// override (the authenticated user for /api/avatar/{register,confirm}, a
// service actor for the public /u/avatar/:refId redirect), so the default
// `getActor` resolver below should never fire — we throw to make the missing
// override loud rather than silently mis-tag log lines.
const roadie = createRoadieClient(env.ROADIE, {
  callerApp: "guestlist",
  getRequestId: () => getRequestId() ?? "unknown",
  getActor: () => {
    throw new Error("guestlist roadie calls must pass an explicit actor override");
  },
});

// Recover a roadie referenceId from a previously-stored user.image URL so
// the prior avatar's roadie reference can be released when a user uploads
// a replacement or removes their avatar. Match by path shape only — host
// varies across environments (worktree dev origins differ from production),
// so locking the regex to a single host would break dev.
// Single source of truth for the roadie referenceId shape, reused by the
// route validator, the path-recovery regex, and any future call site.
const AVATAR_REFID_PATTERN = "[A-Za-z0-9_-]{8,128}";
const AVATAR_REFID_RE = new RegExp(`^${AVATAR_REFID_PATTERN}$`);
// Match the path shape only — host varies across environments (worktree
// dev origins differ from production), so locking to a single host would
// break dev. `formatAvatarUrl` produces the URL; this parses it back.
const AVATAR_PATH_RE = new RegExp(`^/u/avatar/(${AVATAR_REFID_PATTERN})$`);
const AVATAR_HASH_RE = /^[a-f0-9]{64}$/;
const AVATAR_MAX_BYTES = 8 * 1024 * 1024;

function formatAvatarUrl(refId: string): string {
  return `${env.BETTER_AUTH_URL}/u/avatar/${refId}`;
}

function parseAvatarRefId(image: string | null | undefined): string | null {
  if (!image) return null;
  let path: string;
  try {
    path = new URL(image).pathname;
  } catch {
    return null;
  }
  const match = AVATAR_PATH_RE.exec(path);
  return match ? (match[1] ?? null) : null;
}

// Copy Set-Cookie headers off a response from `auth.api.X({returnHeaders: true})`
// onto our outgoing Elysia response. BA writes its session/cookie-cache
// updates to the inner endpoint's headers; without explicit forwarding,
// they never reach the browser and clients keep stale JWT cache state
// (e.g. user.image still pointing at a freshly-derefed roadie blob until
// the 5-min cookieCache.maxAge TTL elapses).
function forwardSetCookies(
  set: { headers: Record<string, string | string[] | number | undefined> },
  src: Headers,
): void {
  const cookies = src.getSetCookie();
  if (cookies.length === 0) return;
  const existing = set.headers["set-cookie"];
  if (existing === undefined) {
    set.headers["set-cookie"] = cookies;
    return;
  }
  const prior = Array.isArray(existing) ? existing : [String(existing)];
  set.headers["set-cookie"] = prior.concat(cookies);
}

// Fire-and-forget release of a roadie reference. Hands the promise to CF's
// ExecutionContext so it survives past the response without blocking the
// caller. Falls back to a swallowed promise if the ALS happens to be empty
// — roadie's pending reaper would still GC the ref eventually.
function deferDeref(referenceId: string, userId: string): void {
  const cleanup = roadie.removeReference({ referenceId }, { kind: "user", userId }).catch(() => {});
  executionContext.getStore()?.waitUntil(cleanup);
}

// Per-request state captured at onRequest, read by the emit hooks below.
// `startMs` lets `emitHttp` compute duration_ms across the full request
// lifecycle (not just the time spent inside the helper).
type RequestState = { startMs: number; path: string };
const requestState = new WeakMap<Request, RequestState>();

const app = new Elysia({
  adapter: CloudflareAdapter,
})
  .use(
    cors({
      origin: corsOrigins,
      credentials: true,
      allowedHeaders: ["content-type", "authorization"],
    }),
  )
  .onRequest(({ request }) => {
    requestState.set(request, {
      startMs: Date.now(),
      path: new URL(request.url).pathname,
    });
  })
  // Each hook emits its own canonical http line via `emitHttp`. One line
  // per request — onError fires for failed requests, onAfterHandle for
  // successful ones. Both read request_id from the active request context
  // (opened at the fetch boundary), so retries / multi-emit cases would
  // share the same id (n/a today: only one of the two hooks fires per
  // request).
  .onError({ as: "global" }, async ({ request, error, code, set }) => {
    const state = requestState.get(request);
    await emitHttp({
      request,
      startMs: state?.startMs ?? Date.now(),
      ...(state?.path !== undefined && { path: state.path }),
      ...(typeof set.status === "number" && { status: set.status }),
      errorCode: String(code),
      errorMessage:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : JSON.stringify(error),
    });
  })
  .onAfterHandle({ as: "global" }, async ({ request, set }) => {
    const state = requestState.get(request);
    const status = typeof set.status === "number" ? set.status : 200;
    await emitHttp({
      request,
      startMs: state?.startMs ?? Date.now(),
      ...(state?.path !== undefined && { path: state.path }),
      status,
    });
  })
  .all("/api/auth/*", ({ request }) => auth.handler(request))
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });
        if (!session) return status(401);
        return { user: session.user, session: session.session };
      },
    },
    admin: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });
        if (!session) return status(401);
        if (session.user.role !== "admin") return status(403, { error: "forbidden" as const });
        return { user: session.user, session: session.session };
      },
    },
  })
  .get("/health", () => ({
    status: "ok" as const,
    service: "guestlist" as const,
  }))
  .get("/providers", ({ set }) => {
    set.headers["cache-control"] = "public, max-age=300";
    return {
      social: {
        google: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
        microsoft: !!env.MICROSOFT_CLIENT_ID && !!env.MICROSOFT_CLIENT_SECRET,
        facebook: !!env.FACEBOOK_CLIENT_ID && !!env.FACEBOOK_CLIENT_SECRET,
        linkedin: !!env.LINKEDIN_CLIENT_ID && !!env.LINKEDIN_CLIENT_SECRET,
      },
    };
  })
  .get("/api/auth/.well-known/openid-configuration", ({ request }) =>
    oauthProviderOpenIdConfigMetadata(auth)(request),
  )
  .get("/.well-known/oauth-authorization-server/api/auth", ({ request }) =>
    oauthProviderAuthServerMetadata(auth)(request),
  )
  .get("/.well-known/openid-configuration", ({ request }) =>
    oauthProviderOpenIdConfigMetadata(auth)(request),
  )
  .get(
    "/admin/stats",
    async () => {
      const [userCount, sessionCount, clientCount] = await Promise.all([
        db.select({ count: count() }).from(user),
        db.select({ count: count() }).from(session),
        db.select({ count: count() }).from(oauthClient),
      ]);
      return {
        users: userCount[0]?.count ?? 0,
        sessions: sessionCount[0]?.count ?? 0,
        clients: clientCount[0]?.count ?? 0,
      };
    },
    { admin: true },
  )
  .get(
    "/admin/sessions",
    async () => {
      const rows = await db
        .select({
          id: session.id,
          userId: session.userId,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          userName: user.name,
          userEmail: user.email,
          userImage: user.image,
        })
        .from(session)
        .leftJoin(user, eq(session.userId, user.id))
        .orderBy(desc(session.createdAt))
        .limit(100);
      return { sessions: rows };
    },
    { admin: true },
  )
  .get(
    "/admin/api-keys",
    async () => {
      const rows = await db
        .select({
          id: apikey.id,
          name: apikey.name,
          prefix: apikey.prefix,
          enabled: apikey.enabled,
          createdAt: apikey.createdAt,
          ownerEmail: user.email,
        })
        .from(apikey)
        .leftJoin(user, eq(apikey.referenceId, user.id))
        .orderBy(desc(apikey.createdAt))
        .limit(100);
      return { apiKeys: rows };
    },
    { admin: true },
  )
  .get(
    "/admin/clients",
    async () => {
      const rows = await db
        .select()
        .from(oauthClient)
        .orderBy(desc(oauthClient.createdAt))
        .limit(100);
      return { clients: rows };
    },
    { admin: true },
  )
  .post(
    "/admin/clients",
    async ({ body, request: { headers } }) => {
      const res = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: body.name,
          redirect_uris: body.redirectUris,
          skip_consent: body.skipConsent,
        },
      });
      return {
        clientId: res.client_id,
        clientSecret: res.client_secret as string,
      };
    },
    {
      admin: true,
      body: t.Object({
        name: t.String({ minLength: 2 }),
        redirectUris: t.Array(t.String({ format: "uri" }), { minItems: 1 }),
        skipConsent: t.Optional(t.Boolean()),
      }),
    },
  )
  .patch(
    "/admin/clients/:id",
    async ({ params, body, request: { headers }, status }) => {
      const rows = await db
        .select({ clientId: oauthClient.clientId })
        .from(oauthClient)
        .where(eq(oauthClient.id, params.id))
        .limit(1);
      const c = rows[0];
      if (!c) return status(404, { error: "not_found" as const });
      await auth.api.adminUpdateOAuthClient({
        headers,
        body: {
          client_id: c.clientId,
          update: {
            ...(body.name !== undefined && { client_name: body.name }),
            ...(body.redirectUris !== undefined && {
              redirect_uris: body.redirectUris,
            }),
            ...(body.skipConsent !== undefined && {
              skip_consent: body.skipConsent,
            }),
          },
        },
      });
      return { success: true as const };
    },
    {
      admin: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 2 })),
        redirectUris: t.Optional(t.Array(t.String({ format: "uri" }), { minItems: 1 })),
        skipConsent: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/admin/clients/:id/rotate-secret",
    async ({ params, request: { headers }, status }) => {
      const rows = await db
        .select({ clientId: oauthClient.clientId })
        .from(oauthClient)
        .where(eq(oauthClient.id, params.id))
        .limit(1);
      const c = rows[0];
      if (!c) return status(404, { error: "not_found" as const });
      const res = await auth.api.rotateClientSecret({
        headers,
        body: { client_id: c.clientId },
      });
      return { clientSecret: res.client_secret as string };
    },
    { admin: true, params: t.Object({ id: t.String() }) },
  )
  .get(
    "/admin/clients/:id",
    async ({ params, status }) => {
      const rows = await db
        .select()
        .from(oauthClient)
        .where(eq(oauthClient.id, params.id))
        .limit(1);
      const c = rows[0];
      if (!c) return status(404, { error: "not_found" as const });
      const [tokenCount, consentCount] = await Promise.all([
        db
          .select({ count: count() })
          .from(oauthAccessToken)
          .where(eq(oauthAccessToken.clientId, c.clientId)),
        db
          .select({ count: count() })
          .from(oauthConsent)
          .where(eq(oauthConsent.clientId, c.clientId)),
      ]);
      return {
        client: c,
        tokenCount: tokenCount[0]?.count ?? 0,
        consentCount: consentCount[0]?.count ?? 0,
      };
    },
    { admin: true, params: t.Object({ id: t.String() }) },
  )
  .delete(
    "/admin/clients/:id",
    async ({ params, request: { headers }, status }) => {
      const rows = await db
        .select({
          clientId: oauthClient.clientId,
          referenceId: oauthClient.referenceId,
        })
        .from(oauthClient)
        .where(eq(oauthClient.id, params.id))
        .limit(1);
      const c = rows[0];
      if (!c) return status(404, { error: "not_found" as const });
      if (c.referenceId?.startsWith("managed:")) {
        return status(409, { error: "managed_client" as const });
      }
      await auth.api.deleteOAuthClient({
        headers,
        body: { client_id: c.clientId },
      });
      return { success: true as const };
    },
    { admin: true, params: t.Object({ id: t.String() }) },
  )
  // ---------- operator: organizations (Surface B) ----------
  // Operator-only org provisioning, per docs/MULTI-TENANCY.md §4.4 + §6.2.
  // BA's auto-mounted `/api/auth/organization/create` always binds the new
  // org to the calling user; the "operator creates org owned by someone
  // else" flow requires calling `auth.api.createOrganization` server-side
  // *without* session headers and passing `userId` explicitly. That's
  // exactly what this route does.
  //
  // BA's slug-collision path throws BAD_REQUEST with the
  // `ORGANIZATION_ALREADY_EXISTS` code. We translate it to 409 so the
  // operator UI can distinguish "the slug you picked is taken" from
  // generic validation failures.
  .post(
    "/admin/orgs/create",
    async ({ body, status }) => {
      try {
        const organization = await auth.api.createOrganization({
          body: {
            name: body.name,
            slug: body.slug,
            userId: body.ownerUserId,
          },
          // intentionally no `headers:` — that's the BA-documented trigger
          // (§4.4) that makes `userId` meaningful and bypasses the session
          // user check.
        });
        return { organization };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/already.?exists|slug/i.test(message)) {
          return status(409, { error: "slug_taken" as const, message });
        }
        throw err;
      }
    },
    {
      admin: true,
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 60 }),
        // Kebab-case: lowercase letters, digits, single hyphens. 2–48 chars.
        slug: t.String({
          pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
          minLength: 2,
          maxLength: 48,
        }),
        ownerUserId: t.String({ minLength: 1 }),
      }),
    },
  )
  // ---------- O-3..O-7 operator org admin (Surface B continued) ----------
  // All routes guarded by `admin: true`. For the BA-mounted endpoints that
  // require session headers (`removeMember`, `updateMemberRole`,
  // `createInvitation`, `cancelInvitation` all have `requireHeaders: true` in
  // BA v1.6 — see crud-members.mjs / crud-invites.mjs), we use direct Drizzle
  // writes against the org tables. `addMember` does tolerate a no-headers
  // call when `body.userId` is provided (it calls `getSessionFromCtx().catch(()
  // => null)`), so we use the BA API for that one. The fallback branches are
  // documented inline at each route.
  .get(
    "/admin/orgs",
    async () => {
      // BA has no "list all orgs across the platform" surface — its
      // `listOrganizations` scopes to caller memberships. Direct join.
      // Two queries — one for the org/count aggregate, one to resolve owner
      // names — merged in JS. Keeps the SQL free of GROUP BY gymnastics
      // around the user-name correlated subquery.
      const orgs = await db
        .select({
          id: organization.id,
          slug: organization.slug,
          name: organization.name,
          logo: organization.logo,
          createdAt: organization.createdAt,
          memberCount: count(member.id),
        })
        .from(organization)
        .leftJoin(member, eq(member.organizationId, organization.id))
        .groupBy(organization.id)
        .orderBy(desc(organization.createdAt))
        .limit(100);
      // One pass for owner names: pick the first `owner`-role member per
      // org. Multiple owners is permitted; we return any one (sorted by
      // member.createdAt asc — i.e. the original creator wins).
      const ownerRows = await db
        .select({
          organizationId: member.organizationId,
          name: user.name,
          createdAt: member.createdAt,
        })
        .from(member)
        .leftJoin(user, eq(member.userId, user.id))
        .where(eq(member.role, "owner"));
      const ownerByOrg = new Map<string, { name: string | null; createdAt: Date }>();
      for (const row of ownerRows) {
        const prior = ownerByOrg.get(row.organizationId);
        if (!prior || row.createdAt < prior.createdAt) {
          ownerByOrg.set(row.organizationId, {
            name: row.name,
            createdAt: row.createdAt,
          });
        }
      }
      return {
        organizations: orgs.map((o) => ({
          ...o,
          ownerName: ownerByOrg.get(o.id)?.name ?? null,
        })),
      };
    },
    { admin: true },
  )
  .get(
    "/admin/users/search",
    async ({ query }) => {
      // Min prefix length 2 — anything shorter would be a no-op scan over
      // every user. Mirror the empty result so the client can render the
      // dropdown deterministically.
      const prefix = (query.email ?? "").trim();
      if (prefix.length < 2) return { users: [] };
      // Escape LIKE metacharacters in the user-supplied prefix. Postgres-
      // style `%` and `_` exist in SQLite too; missing this would let a
      // user type `_` and match every email.
      const escaped = prefix.replace(/[\\%_]/g, "\\$&");
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(like(user.email, escaped + "%"))
        .orderBy(user.email)
        .limit(10);
      return { users: rows };
    },
    {
      admin: true,
      query: t.Object({
        email: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/admin/orgs/:id",
    async ({ params, status }) => {
      const orgRows = await db
        .select()
        .from(organization)
        .where(eq(organization.id, params.id))
        .limit(1);
      const org = orgRows[0];
      if (!org) return status(404, { error: "not_found" as const });
      const memberRows = await db
        .select({
          memberId: member.id,
          userId: member.userId,
          name: user.name,
          email: user.email,
          image: user.image,
          role: member.role,
          joinedAt: member.createdAt,
        })
        .from(member)
        .leftJoin(user, eq(member.userId, user.id))
        .where(eq(member.organizationId, params.id));
      // Sort: owner first, then admin, then member alphabetically by name.
      // SQLite collation differs from JS sort, but the secondary key
      // (alphabetical within role) is small enough to be cheap in JS.
      const ROLE_RANK: Record<string, number> = {
        owner: 0,
        admin: 1,
        member: 2,
      };
      memberRows.sort((a, b) => {
        const ra = ROLE_RANK[a.role] ?? 99;
        const rb = ROLE_RANK[b.role] ?? 99;
        if (ra !== rb) return ra - rb;
        return (a.name ?? "").localeCompare(b.name ?? "");
      });
      const invitationRows = await db
        .select({
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
          inviterName: user.name,
        })
        .from(invitation)
        .leftJoin(user, eq(invitation.inviterId, user.id))
        .where(and(eq(invitation.organizationId, params.id), eq(invitation.status, "pending")));
      return {
        organization: org,
        members: memberRows,
        invitations: invitationRows,
      };
    },
    { admin: true, params: t.Object({ id: t.String() }) },
  )
  .post(
    "/admin/orgs/:id/members",
    async ({ params, body, status }) => {
      // BA's `addMember` tolerates no-headers when `body.userId` is set —
      // its handler calls `getSessionFromCtx(ctx).catch(() => null)` and
      // then uses `body.organizationId` directly. Same pattern as
      // `createOrganization` above.
      try {
        const created = await auth.api.addMember({
          body: {
            userId: body.userId,
            organizationId: params.id,
            role: body.role,
          },
          // intentionally no `headers:` — operator-as-superuser path.
        });
        return { member: created };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/already a member/i.test(message)) {
          return status(409, { error: "already_member" as const, message });
        }
        if (/not.?found|user not found/i.test(message)) {
          return status(404, { error: "not_found" as const, message });
        }
        throw err;
      }
    },
    {
      admin: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        userId: t.String({ minLength: 1 }),
        role: t.Union([t.Literal("owner"), t.Literal("admin"), t.Literal("member")]),
      }),
    },
  )
  .post(
    "/admin/orgs/:id/members/:userId/update-role",
    async ({ params, body, status }) => {
      // BA's `updateMemberRole` has `requireHeaders: true` (crud-members.mjs
      // line 208) + `orgSessionMiddleware`. There is no documented way to
      // bypass that from server code without forging a session. Direct
      // Drizzle UPDATE is the documented fallback per §6.2's
      // implementation-honesty note.
      const targetRows = await db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, params.id), eq(member.userId, params.userId)))
        .limit(1);
      const target = targetRows[0];
      if (!target) return status(404, { error: "member_not_found" as const });
      // Last-owner guard: if target is currently the only `owner` and the
      // new role is not `owner`, refuse. Run BEFORE mutating so we don't
      // need to roll back.
      if (target.role === "owner" && body.role !== "owner") {
        const ownerCountRows = await db
          .select({ count: count() })
          .from(member)
          .where(and(eq(member.organizationId, params.id), eq(member.role, "owner")));
        const ownerCount = ownerCountRows[0]?.count ?? 0;
        if (ownerCount <= 1) {
          return status(400, { error: "cannot_demote_last_owner" as const });
        }
      }
      await db
        .update(member)
        .set({ role: body.role })
        .where(and(eq(member.organizationId, params.id), eq(member.userId, params.userId)));
      return { success: true as const };
    },
    {
      admin: true,
      params: t.Object({ id: t.String(), userId: t.String() }),
      body: t.Object({
        role: t.Union([t.Literal("owner"), t.Literal("admin"), t.Literal("member")]),
      }),
    },
  )
  .post(
    "/admin/orgs/:id/members/:userId/remove",
    async ({ params, status }) => {
      // Same fallback rationale as update-role: BA's removeMember has
      // `requireHeaders: true`.
      const targetRows = await db
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, params.id), eq(member.userId, params.userId)))
        .limit(1);
      const target = targetRows[0];
      if (!target) return status(404, { error: "member_not_found" as const });
      // Last-owner guard mirrors update-role: never let the org end up with
      // zero owners through this surface. (BA's own removeMember enforces
      // the same invariant via `YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER`.)
      if (target.role === "owner") {
        const ownerCountRows = await db
          .select({ count: count() })
          .from(member)
          .where(and(eq(member.organizationId, params.id), eq(member.role, "owner")));
        const ownerCount = ownerCountRows[0]?.count ?? 0;
        if (ownerCount <= 1) {
          return status(400, { error: "cannot_remove_last_owner" as const });
        }
      }
      await db
        .delete(member)
        .where(and(eq(member.organizationId, params.id), eq(member.userId, params.userId)));
      return { success: true as const };
    },
    {
      admin: true,
      params: t.Object({ id: t.String(), userId: t.String() }),
    },
  )
  .post(
    "/admin/orgs/:id/invitations",
    async ({ params, body, user: u, status }) => {
      // BA's `createInvitation` has `requireHeaders: true` and uses the
      // calling user's session to populate `inviterId`. Operator path: the
      // operator (resolved via the `admin: true` macro above) becomes the
      // inviter. Direct insert; the `sendInvitationEmail` callback is *not*
      // invoked here (doing so requires a synthetic auth context to call
      // BA's adapter) — operator-issued invitations surface the raw link
      // in the UI per O-6's design.
      const orgRows = await db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, params.id))
        .limit(1);
      if (!orgRows[0]) return status(404, { error: "org_not_found" as const });
      const now = new Date();
      // Operator-issued invitations expire after 7 days, longer than BA's
      // default 48h window.
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const id = ulid();
      await db.insert(invitation).values({
        id,
        organizationId: params.id,
        email: body.email,
        role: body.role,
        status: "pending",
        inviterId: u.id,
        createdAt: now,
        expiresAt,
      });
      return {
        invitation: {
          id,
          organizationId: params.id,
          email: body.email,
          role: body.role,
          status: "pending" as const,
          inviterId: u.id,
          createdAt: now.getTime(),
          expiresAt: expiresAt.getTime(),
        },
      };
    },
    {
      admin: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        email: t.String({ format: "email", minLength: 3, maxLength: 254 }),
        role: t.Union([t.Literal("owner"), t.Literal("admin"), t.Literal("member")]),
      }),
    },
  )
  .post(
    "/admin/orgs/:id/invitations/:invitationId/cancel",
    async ({ params, status }) => {
      // BA's `cancelInvitation` also has `requireHeaders: true`. Direct
      // UPDATE with status transitions; 404 if the row is missing, 409 if
      // it's already terminal (accepted / rejected / cancelled).
      const rows = await db
        .select({ id: invitation.id, status: invitation.status })
        .from(invitation)
        .where(
          and(eq(invitation.id, params.invitationId), eq(invitation.organizationId, params.id)),
        )
        .limit(1);
      const inv = rows[0];
      if (!inv) return status(404, { error: "invitation_not_found" as const });
      if (inv.status !== "pending") {
        return status(409, {
          error: "invitation_not_pending" as const,
          status: inv.status,
        });
      }
      await db
        .update(invitation)
        .set({ status: "cancelled" })
        .where(eq(invitation.id, params.invitationId));
      return { success: true as const };
    },
    {
      admin: true,
      params: t.Object({ id: t.String(), invitationId: t.String() }),
    },
  )
  .get(
    "/user/connections",
    async ({ user: u }) => {
      const rows = await db
        .select({
          consentId: oauthConsent.id,
          clientId: oauthConsent.clientId,
          scopes: oauthConsent.scopes,
          createdAt: oauthConsent.createdAt,
          clientName: oauthClient.name,
          clientIcon: oauthClient.icon,
        })
        .from(oauthConsent)
        .leftJoin(oauthClient, eq(oauthConsent.clientId, oauthClient.clientId))
        .where(eq(oauthConsent.userId, u.id));
      return { connections: rows };
    },
    { auth: true },
  )
  // ---------- user directory primitives ----------
  // General authenticated user-lookup surface (mentions, member pickers,
  // display-name resolution). v1 returns `email` on every hit; identity
  // already exposes emails to org admins, so this isn't a new leak. Tighten
  // later if a less-trusted caller appears.
  .post(
    "/api/users/search",
    async ({ body }) => {
      const raw = (body.query ?? "").trim().toLowerCase();
      // Empty query short-circuits to []. Returning the full user table on a
      // blank input would be a data-exposure footgun.
      if (raw.length === 0)
        return {
          users: [] as Array<{
            id: string;
            name: string;
            email?: string;
            image?: string;
          }>,
        };
      const limit = Math.min(Math.max(body.limit ?? 20, 1), 50);
      const escaped = raw.replace(/[\\%_]/g, "\\$&");
      const namePattern = `%${escaped}%`;
      const emailPattern = `%${escaped}%`;
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(or(like(user.name, namePattern), like(user.email, emailPattern)))
        .orderBy(user.name)
        .limit(limit);
      return {
        users: rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          ...(r.image !== null && { image: r.image }),
        })),
      };
    },
    {
      auth: true,
      body: t.Object({
        query: t.String({ maxLength: 200 }),
        limit: t.Optional(t.Integer({ minimum: 1, maximum: 50 })),
      }),
    },
  )
  .post(
    "/api/users/by-ids",
    async ({ body }) => {
      if (body.ids.length === 0)
        return {
          users: [] as Array<{
            id: string;
            name: string;
            email?: string;
            image?: string;
          }>,
        };
      const rows = await db
        .select({
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        })
        .from(user)
        .where(inArray(user.id, body.ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      const ordered: Array<{
        id: string;
        name: string;
        email?: string;
        image?: string;
      }> = [];
      for (const id of body.ids) {
        const r = byId.get(id);
        if (!r) continue;
        ordered.push({
          id: r.id,
          name: r.name,
          email: r.email,
          ...(r.image !== null && { image: r.image }),
        });
      }
      return { users: ordered };
    },
    {
      auth: true,
      body: t.Object({
        ids: t.Array(t.String({ minLength: 1 }), { maxItems: 100 }),
      }),
    },
  )
  // ---------- avatar ----------
  // Three-step presigned upload flow: the browser asks /api/avatar/register
  // for a presigned envelope, PUTs the bytes directly to R2, then calls
  // /api/avatar/confirm to finalize the blob, write the resulting URL onto
  // user.image, and drop the prior avatar's roadie reference. Atomic on
  // the server. /u/avatar/:refId is the public read broker — a 302 to a
  // short-lived roadie presigned GET URL. Guestlist never streams bytes.
  .post(
    "/api/avatar/register",
    async ({ user: u, body, status }) => {
      const result = await roadie.registerUpload(
        {
          hash: body.hash,
          size: body.size,
          contentType: body.contentType,
          application: {
            app: "guestlist",
            resourceType: "user-avatar",
            resourceId: u.id,
          },
        },
        { kind: "user", userId: u.id },
      );
      if (!result.ok) {
        // size_exceeds_limit / invalid_hash / size_mismatch — caller's fault.
        return status(400, { error: result.error });
      }
      // Flatten roadie's envelope into the shape the client's `runUpload`
      // driver expects: status + presigned fields at the top level. Avatars
      // never enter the multipart branch (size capped < SINGLE_PART_LIMIT),
      // but we forward the type so unexpected callers get a useful error.
      const v = result.value;
      const referenceId = v.referenceId;
      if (v.status === "ready") {
        return { referenceId, upload: { status: "ready" as const } };
      }
      if (v.status === "single-part") {
        return {
          referenceId,
          upload: {
            status: "single-part" as const,
            uploadUrl: v.upload.uploadUrl,
            requiredHeaders: v.upload.requiredHeaders,
          },
        };
      }
      return {
        referenceId,
        upload: {
          status: "multipart" as const,
          partSize: v.partSize,
          partCount: v.partCount,
        },
      };
    },
    {
      auth: true,
      body: t.Object({
        hash: t.String({ pattern: AVATAR_HASH_RE.source }),
        size: t.Integer({ minimum: 1, maximum: AVATAR_MAX_BYTES }),
        contentType: t.Union([
          t.Literal("image/jpeg"),
          t.Literal("image/png"),
          t.Literal("image/webp"),
        ]),
      }),
    },
  )
  .post(
    "/api/avatar/confirm",
    async ({ user: u, body, request: { headers }, status, set }) => {
      // Caller-scoping (callerApp = "guestlist") in roadie already keeps
      // cross-caller refs invisible; we additionally verify application-
      // level ownership so a user can't confirm a ref registered for a
      // different user. Skip finalize for "ready" envelopes (dedup hit) —
      // the blob is already finalized.
      const ref = await roadie.getReference(
        { referenceId: body.referenceId },
        { kind: "user", userId: u.id },
      );
      if (!ref.ok) return status(404, { error: ref.error });
      if (
        ref.value.application.resourceType !== "user-avatar" ||
        ref.value.application.resourceId !== u.id
      ) {
        return status(403, { error: "forbidden" as const });
      }
      if (ref.value.state === "pending") {
        const fin = await roadie.finalize(
          { referenceId: body.referenceId },
          { kind: "user", userId: u.id },
        );
        if (!fin.ok) return status(502, { error: fin.error });
      } else if (ref.value.state === "deleted") {
        return status(410, { error: "deleted" as const });
      }

      const newImage = formatAvatarUrl(body.referenceId);

      let baHeaders: Headers;
      try {
        // `returnHeaders: true` exposes BA's session-cache refresh cookies so
        // we can forward them to the browser; without this the JWT cache
        // sticks around for its 5-min TTL with the old user.image.
        ({ headers: baHeaders } = await auth.api.updateUser({
          headers,
          body: { image: newImage },
          returnHeaders: true,
        }));
      } catch (e) {
        // Roll back the orphaned reference so refcount stays correct.
        deferDeref(body.referenceId, u.id);
        return status(502, {
          error: "persist_failed" as const,
          message: e instanceof Error ? e.message : String(e),
        });
      }

      forwardSetCookies(set, baHeaders);
      const oldRefId = parseAvatarRefId(u.image);
      if (oldRefId && oldRefId !== body.referenceId) {
        deferDeref(oldRefId, u.id);
      }
      return { image: newImage };
    },
    {
      auth: true,
      body: t.Object({
        referenceId: t.String({ pattern: AVATAR_REFID_RE.source }),
      }),
    },
  )
  .delete(
    "/api/avatar",
    async ({ user: u, request: { headers }, set }) => {
      const { headers: baHeaders } = await auth.api.updateUser({
        headers,
        body: { image: null },
        returnHeaders: true,
      });
      forwardSetCookies(set, baHeaders);
      const oldRefId = parseAvatarRefId(u.image);
      if (oldRefId) deferDeref(oldRefId, u.id);
      return { image: null as null };
    },
    { auth: true },
  )
  .get(
    "/u/avatar/:refId",
    async ({ params, status, set }) => {
      if (!AVATAR_REFID_RE.test(params.refId)) return status(404);
      const result = await roadie.getReadUrl(
        {
          referenceId: params.refId,
          lifetimeSeconds: 600,
          permissionScope: "public-avatar",
        },
        { kind: "service", serviceName: "guestlist-avatar-redirect" },
      );
      if (!result.ok) return status(404);
      set.status = 302;
      set.headers["location"] = result.value.url;
      // Edge-cache the redirect for 5 min — shorter than the 10-min presign
      // TTL so a cache hit can never return a URL that's already expired.
      set.headers["cache-control"] = "public, max-age=300, immutable";
      return null;
    },
    { params: t.Object({ refId: t.String() }) },
  )
  .head(
    "/u/avatar/:refId",
    async ({ params, status, set }) => {
      if (!AVATAR_REFID_RE.test(params.refId)) return status(404);
      const result = await roadie.getReadUrl(
        {
          referenceId: params.refId,
          lifetimeSeconds: 600,
          permissionScope: "public-avatar",
        },
        { kind: "service", serviceName: "guestlist-avatar-redirect" },
      );
      if (!result.ok) return status(404);
      set.status = 302;
      set.headers["location"] = result.value.url;
      set.headers["cache-control"] = "public, max-age=300, immutable";
      return null;
    },
    { params: t.Object({ refId: t.String() }) },
  )
  .compile();

export type GuestlistApp = typeof app;

// The default export wraps `app.fetch(req)` in two ALS scopes:
//
//   1. `withExecutionContext` (plugins/execution-context.ts) — seeds CF's
//      ExecutionContext for Better Auth's `backgroundTasks.handler` (BA reads
//      this back via `executionContext.getStore()` to call
//      `ctx.waitUntil(...)`). Applied at the outer boundary since Elysia's
//      CloudflareAdapter never forwards `ctx` into the app itself.
//
//   2. `withRequestContext({requestId, callerApp, actorKind, actorId})` —
//      captures correlation context at the boundary so every canonical-log
//      line emitted during this request shares the same context. The
//      `x-caller-app`, `x-actor-kind`, and `x-actor-id` headers are
//      caller-asserted by the guestlist client — they're LOG CORRELATION
//      ONLY. Guestlist's authoritative identity for authz still flows
//      through cookies → BA `/get-session` → DB. Never read these headers
//      anywhere except this boundary, and never pass them to authz code.
export default withExecutionContext({
  fetch(request: Request): Promise<Response> {
    // Version endpoint, answered at the boundary before Elysia routing.
    // Two spellings: /__version (direct / service-binding calls) and
    // /api/__version (bouncer mounts guestlist at /api in PASSTHROUGH mode —
    // the prefix is not stripped, so the mounted spelling must answer too).
    // Values are ship-time-injected vars — see @si/kit/version.
    const version = handleVersionRequest(request, {
      worker: "guestlist",
      env,
      paths: ["/__version", "/api/__version"],
    });
    if (version) return Promise.resolve(version);
    return withRequestContext(
      {
        requestId: extractRequestId(request),
        callerApp: request.headers.get("x-caller-app") ?? undefined,
        actorKind: request.headers.get("x-actor-kind") ?? undefined,
        actorId: request.headers.get("x-actor-id") ?? undefined,
      },
      () => app.fetch(request) as Promise<Response>,
    );
  },
});
