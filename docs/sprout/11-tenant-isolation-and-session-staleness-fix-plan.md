# 11 · Tenant-Isolation & Session-Staleness Fix Plan

> **Status:** Spec, ready to execute. Decisions LOCKED (see below). This document is
> self-contained — a coding session that has not seen the diagnosis conversation can
> execute it end to end. Do **not** re-derive the root cause; it is settled.

## Executive summary

Every brand-scoped server fn in `workers/sprout` scopes tenant data by
`context.principal.activeOrgId` — the **active org** carried on the verified bouncer
envelope — instead of by the **brand the user is actually viewing** (resolved from the
host label in subdomain mode, or the client-settable `sprout_brand` cookie in path
mode). Nothing ever syncs active-org to the viewed brand, and it _cannot_ be synced for
budtenders, who have `portal_members` rows but **no** better-auth org membership (so
`activeOrgId` is `null` for them). The universal `if (!brandId) return []` guard then
turns every read into a silently-empty result — the reported "no banner cards, no
product scroll, empty feed/decks" symptom — while cross-brand members silently see the
_wrong_ tenant's data under the viewed brand's skin. Compounding this, kit's client
`AuthProvider` seeds the session from SSR **once** and never reconciles, so the browser
keeps rendering signed-in admin/Hub chrome while the server authorizes `null`; and the
shared `HeaderUserMenu` sign-out uses a raw fetch that must instead go through a
kit/guestlist auth client.

The fix is a **full refactor**: introduce a server-only viewed-brand resolver that
produces an **authorized** `context.brand = { id, slug, role }`, two composable gates
(`requireBrandAudience` for reads, `requireBrandAdmin` for writes) that make membership
of the viewed brand the tenant-isolation boundary, and convert **all ~120 brand-scoped
server fns** to scope by `context.brand.id`. Non-members get sign-in / not-authorized —
**never** another brand's data and **never** a silently-empty portal. Plus: reconcile
the client auth provider on navigation, make loaders redirect/notFound when the server
can't authorize, route sign-out through a kit/guestlist auth client, migrate the
realtime DO gate and roadie blob scopes to the viewed brand, and reconcile the
persisted RAG/analytics corpus that was written under the wrong brand id.

---

## Decisions (LOCKED)

1. **Full refactor.** Introduce viewed-brand gates and convert every brand-scoped server
   fn (~120 handlers, 118 `activeOrgId` reads) to scope by an authorized
   `context.brand.id`. No incremental / per-symptom patching.
2. **Audience-only visibility.** A non-member hitting `/b/<brand>` gets sign-in or
   not-authorized. Never another brand's data. Never a silently-empty 200 portal. The
   membership check (portal-member **OR** org-member **OR** platform-admin of the
   **viewed** brand) _is_ the tenant-isolation boundary and is exactly what makes
   path-mode's client-settable `sprout_brand` cookie safe.
3. **`requireBrandAudience`** gates reads: signed-in AND audience of the viewed brand,
   else reject (`notFound`).
4. **`requireBrandAdmin`** gates writes: audience AND `decideBrandAdmin` against the
   caller's **org role for the viewed brand**, else reject.
5. **`context.brand = { id, slug, role }`** is resolved and authorized **once** per
   request; handlers read `context.brand.id`, never `context.principal.activeOrgId`.
6. **No `setActiveOrganization` on portal entry.** It cannot work for budtenders and is
   unnecessary — the viewed brand + membership is the tenant key.
7. **Sign-out goes through a kit/guestlist auth client**, never raw fetch. The raw-fetch
   fallback in the shared `packages/ui` `HeaderUserMenu` is removed.

---

## Root cause

Four independent defects stack into "signed in but every resource is empty."

### R1 — `activeOrgId`-as-tenant model (the core bug)

Every brand-scoped handler does:

```ts
const brandId = context.principal.activeOrgId; // session ACTIVE ORG
if (!brandId) return []; // ← silent-empty source
// ... WHERE table.brandId = brandId
```

`activeOrgId` is the session's active better-auth org. The **viewed** brand comes from
`getRequestBrandSlug()` (`lib/request-host.ts`) → `resolveBrandBySlug()`
(`lib/brand.server.ts`) and today only drives the cosmetic **skin**. Nothing puts the
viewed brand on server-fn `context`, and nothing checks that the caller may see it.
Consequences:

- **Budtenders** (portal members, no org membership) always have `activeOrgId = null` →
  `if (!brandId) return []` → empty everything on their own brand.
- **Cross-brand members** (active in A, viewing B) read/write **A's** data under B's
  skin, or hit `not_found` on B's ids — a real cross-tenant leak/misattribution.

### R2 — Active org and viewed brand are orthogonal _by design_ — never sync them

This is not a limitation to engineer around; it is the domain model, and the refactor must
encode it. **Active org** is a USER↔membership concept — which of _my own_ orgs I am acting
as (a better-auth org-plugin notion, owned by identity/guestlist). **Brand** is which of
_our tenants_ I am currently looking at (resolved from host in subdomain mode / the
`sprout_brand` cookie in path mode). They are independent axes:

- a budtender is the audience of brands they have **no org membership in at all**
  (`activeOrgId` is `null` for them, yet they legitimately view that brand); and
- an org-admin of Acme can be **viewing Beta** with Acme still "active."

So there is no `setActiveOrganization`-on-entry that could ever be correct — syncing the
two would re-conflate concepts that are meant to be separate (and can't even be expressed
for budtenders). The fix is the opposite of syncing: the portal's data + authz layer must
**stop reading `activeOrganizationId` entirely** and key everything on the **viewed brand +
the caller's membership in it** (`context.brand`). Active org stays a pure
identity/Hub-membership concept, untouched by the portal.

### R3 — Sticky client auth (session staleness)

`packages/kit/src/react-start/auth-provider.tsx` seeds `useState(initialSession)` from
SSR once (line 51) and only mutates on explicit `refetch()` (lines 54–62). It never
reconciles on mount/route change. Every derived flag (`isAuthenticated`, `user`,
`hasRole`) reads the frozen seed, so the client renders signed-in admin/Hub chrome while
the server resolves `null`-or-different. The SSR seed itself
(`platform-start-app.ts getSession()`, line 210) can also diverge: a valid envelope with
a blipping guestlist RPC returns `null` (RPC-any-throw → null, lines 218–221), so the
loader empties the portal / bounces to sign-in despite a valid session.

### R4 — Sign-out 415, band-aided but wrong

`packages/ui/.../header-user-menu.tsx` default handler POSTed `/api/auth/sign-out` with
no `Content-Type: application/json` → guestlist 415 → session never cleared. A raw
content-type patch was applied, but per the owner sign-out must go through a
kit/guestlist auth **client**, not raw fetch. `hub.tsx` and `sprout-admin.tsx` render
`HeaderUserMenu` with no `onSignOut`, so they fall through to that default path.

---

## Design

### D1 · Viewed-brand resolver + `context.brand = { id, slug, role }`

New module **`workers/sprout/src/lib/brand-context.server.ts`** — one server-only async
resolver that turns "the request" into an **authorized** viewed brand, unifying
slug-resolution + membership and replacing the scattered
`resolveBrandBySlug(getRequestBrandSlug())` probes.

```ts
// server-only (headers + D1 + guestlist)
export type BrandStanding =
  | "platform-admin" // isPlatformAdmin(actor.role)
  | "owner"
  | "admin"
  | "member" // better-auth org membership of the VIEWED brand
  | "staff"
  | "budtender"; // portal_members standing (no org membership)

export interface ViewedBrand {
  id: string;
  slug: string;
  role: BrandStanding;
}

/** Resolve the viewed brand AND the caller's standing in it, or a rejection reason.
 *  userId / actorRole come from the verified envelope principal (never input). */
export async function resolveViewedBrandFor(
  userId: string,
  actorRole: string | readonly string[] | null | undefined,
): Promise<
  | { ok: true; brand: ViewedBrand }
  | { ok: false; reason: "no-brand" | "unknown-brand" | "not-member" }
> {
  const slug = getRequestBrandSlug();
  if (!slug) return { ok: false, reason: "no-brand" }; // apex/Hub — not a portal fn
  const viewed = await resolveBrandBySlug(slug);
  if (!viewed) return { ok: false, reason: "unknown-brand" }; // bogus slug/cookie → notFound

  if (isPlatformAdmin(actorRole))
    return { ok: true, brand: { id: viewed.orgId, slug, role: "platform-admin" } };

  const portal = await getPortalRole(viewed.orgId, userId); // audience layer
  if (portal) return { ok: true, brand: { id: viewed.orgId, slug, role: portal } };

  // Lazy org→portal sync (preserved from getMyBrandRole): org staff of THIS brand are
  // folded into the audience on first hit, then treated as members forever.
  const orgRole = await getCallerOrgRole(viewed.orgId); // passes organizationId explicitly
  if (orgRole) {
    await ensurePortalMember({ brandId: viewed.orgId, userId, role: "staff", source: "org" });
    return { ok: true, brand: { id: viewed.orgId, slug, role: orgRole } };
  }

  return { ok: false, reason: "not-member" }; // signed-in, not audience → reject
}
```

**Key property:** `role` is resolved against the **viewed** brand.
`getCallerOrgRole(viewed.orgId)` passes `organizationId` explicitly to better-auth's
`getActiveMemberRole` (proven cross-brand-safe by `approveAccess`), so it works even
when the viewed brand is not the session's active org — and works for budtenders (no
active org) via `getPortalRole`.

> **Cross-cutting precondition to verify once:** confirm better-auth's
> `getActiveMemberRole({ query: { organizationId } })` actually scopes to the **passed**
> org, not the session's active org. `approveAccess` and the whole `requireBrandAdmin`
> design depend on per-target-org role resolution. (Audited-clean finding on hub confirms
> this is the intended contract; re-verify in code before relying on it platform-wide.)

### D2 · The two gates — `workers/sprout/src/lib/middleware/auth.ts`

`createPrincipalGate` narrows synchronously and cannot do the async D1/guestlist hop, so
the gates **compose on top of** `requireUserMiddleware` (itself a principal gate over
`envelopeMiddleware`) and add the async brand resolution in `.server()`. Stacking by
reference means TSS runs the envelope verify + user check exactly once even when
`requireBrandAdmin → requireBrandAudience → requireUserMiddleware` all appear.

```ts
import { createMiddleware, notFound } from "@tanstack/react-start";

/** READS: signed-in AND (portal-member OR org-member OR platform-admin) of the
 *  VIEWED brand. Exposes context.brand once, resolved+authorized. */
export const requireBrandAudience = createMiddleware({ type: "request" })
  .middleware([requireUserMiddleware]) // guarantees principal.kind === "user"
  .server(async ({ next, context }) => {
    const { actor } = context.principal; // narrowed by requireUserMiddleware
    const res = await resolveViewedBrandFor(actor.id, actor.role);
    if (!res.ok) throw notFound(); // cloak: no data, no silently-empty 200
    return next({ context: { brand: res.brand } });
  });

/** WRITES: audience AND decideBrandAdmin against the viewed brand's org role. */
export const requireBrandAdmin = createMiddleware({ type: "request" })
  .middleware([requireBrandAudience]) // reuses the resolution above
  .server(async ({ next, context }) => {
    const { actor } = context.principal;
    const orgRole =
      context.brand.role === "platform-admin"
        ? null
        : (["owner", "admin", "member"] as const).includes(context.brand.role as OrgRole)
          ? (context.brand.role as OrgRole)
          : null; // budtender/staff → no org role
    const decision = decideBrandAdmin({ actorRole: actor.role, orgRole });
    if (!decision.ok) throw notFound(); // member but not admin → cloak admin surface
    return next({ context: { brand: context.brand } }); // role now ∈ owner|admin|platform-admin
  });
```

**Reject behavior:**

- Not signed in → `requireUserMiddleware.onReject` already `redirect({ href: "/sign-in" })`.
- Signed-in non-member / bogus brand → `notFound()` (audience gate). Route loaders
  translate to the not-authorized/not-found shell (D4b), never a blank portal.
- Member but not admin → `notFound()` (admin gate).

### D3 · Handler switch (mechanical)

Every brand-scoped **read**:

```diff
-  .middleware([requireUserMiddleware])
+  .middleware([requireBrandAudience])
   .handler(async ({ context }) => {
-    const brandId = context.principal.activeOrgId; // NEVER from input
-    if (!brandId) return [];                        // ← DELETE (the silent-empty source)
+    const brandId = context.brand.id;              // authorized viewed brand, non-null
```

Every brand-scoped **write**:

```diff
-  .middleware([requireUserMiddleware])
+  .middleware([requireBrandAdmin])
   .handler(async ({ data, context }) => {
-    const brandId = context.principal.activeOrgId;
-    if (!brandId) throw new Error("no_active_org");
-    await assertBrandAdmin(brandId, context.principal.actor.role);
+    const brandId = context.brand.id;              // role proven owner|admin|platform-admin
```

- The `if (!brandId) return []` / `throw no_active_org` guards are **deleted everywhere**.
- The local `assertBrandAdmin` helpers (`brand.functions.ts`, `decks.functions.ts`,
  `chat.functions.ts`) and inline `getCallerOrgRole(activeOrgId)+decideBrandAdmin` blocks
  (~20 callsites) collapse into `requireBrandAdmin` — one fewer guestlist round-trip per
  write.
- `portal.functions.ts` `getMyOrgRole`/`getMyBrandRole` become thin: gate with
  `requireBrandAudience`, return `context.brand.role`; the lazy sync moves into the
  resolver.
- **Audience-only member writes that are POST but NOT admin** (engagement/own-content)
  use `requireBrandAudience`, not `requireBrandAdmin`: banner impression/click/dismiss,
  likePost, addComment, heartComment, own deleteComment, reviews (own), quiz take-flow,
  sessions booking/registration, requests (own), download counters, contact (own),
  notifications pref, chat send.

**Do NOT convert (cross-brand / platform surfaces, keyed by `actor.id` or target-brand):**
`hub.functions.ts` — `listMyPortals`, `listJoinableBrands`, `getFeaturedBrand`,
`getUnreadCounts`, `requestAccess`, `syncOrgDirectory` (→ gets a **platform-admin** gate
instead, see table), and `approveAccess` (keeps its **target-brand**
`decideBrandAdmin(getCallerOrgRole(data.brandId))`); `award.functions.ts` (org∪portal
membership); `credentials.functions.ts` (per-user / platform-admin);
`sprout-admin.functions.ts` (platform-admin god-mode); `notifications.functions.ts`
list/mark fns (user-scoped) — **except** `setNotificationPref` (see table);
`jobs/cron.ts` and `jobs/queue.ts` consumers (system principals, payload-scoped).

### D4 · Session-staleness fixes

**(a) Live session check via `authClient.useSession()` — fix at the read site, not in
shared kit.** **DECISION (supersedes the earlier draft of this section):** do **not**
patch `packages/kit/src/react-start/auth-provider.tsx`. That file is shared across every
fork, and a route-change `refetch()` there is exactly the kind of platform-wide change the
Risks section originally flagged as needing refetch-storm verification. Instead reuse the
pattern already proven in `workers/identity/src/routes/_dashboard.tsx`: read better-auth's own
live session hook off the D4c `authClient` directly, merged with the SSR-seeded session, at
each route that currently trusts a possibly-stale client session:

```ts
const { session: ssrSession } = Route.useRouteContext();
const { data: liveSession, isPending } = authClient.useSession();
const session = liveSession ?? ssrSession;

useEffect(() => {
  // Bounce only when BOTH are absent after the live query settles — redirecting on
  // `!liveSession` alone risks the sign-in ⇄ route bounce loop identity's
  // `_dashboard.tsx` comment warns about (a transient get-session failure must not
  // evict a still-valid SSR session).
  if (!isPending && !liveSession && !ssrSession) {
    void navigate({ href: "/sign-in", replace: true });
  }
}, [isPending, liveSession, ssrSession, navigate]);
```

- `useAuth()` (kit's `createAuthContext`) is untouched — it stays SSR-seed-once. It's fine
  for display-only reads that don't gate access; the server gates (`requireBrandAudience`/
  `requireBrandAdmin`) remain the actual tenant boundary regardless of client staleness.
- Apply the merge at the routes flagged in D4b: `hub.tsx`, `admin.tsx`, and
  `sprout-admin.tsx` (swap its existing `useAuth()`-based two-stage check, see
  `workers/sprout/src/routes/sprout-admin.tsx:82-89`, to `authClient.useSession()`); `_portal.tsx`
  only if it grows a client-side gate beyond the loader.
- **Ordering dependency:** requires D4c's `workers/sprout/src/lib/auth-client.ts` to exist
  first — pull that file's creation forward into Phase 5 (see execution plan).

**(b) Loaders must redirect/notFound when the SERVER can't authorize — kill silent-empty
shells.**

- **`routes/_portal.tsx`** — the whole portal is audience-only. Replace
  `context.session ? Promise.all([...]) : [[], null, null]` with a
  `requireBrandAudience`-backed probe; on reject `redirect` to `/sign-in` (anonymous) or
  render the not-authorized shell (signed-in non-member). Remove the empty-data fallback;
  no signed-out user should reach a rendered portal.
- **`routes/_portal/index.tsx`** — `listHeroSlides` is currently public + un-gated and
  reads the viewed brand directly, so any anonymous visitor can read any brand's hero
  art. Under audience-only, move it behind `requireBrandAudience` (drop the "apex → []"
  path; the portal never renders on apex). _(If product later wants a public pre-auth
  hero, that is a deliberate re-exception — default is members-only.)_
- **`routes/hub.tsx`** — `beforeLoad` trusts root `context.session` (doesn't re-run on
  SPA nav). Add a live client re-check (mirror `sprout-admin.tsx`'s two-stage pattern):
  keep the SSR bounce for a definitively-absent session, add a component re-check once
  `AuthProvider` reconciles; don't paint an empty Hub.
- **`routes/admin.tsx`** — replace the
  `adminBrandRedirectSlug(getActiveOrgBrandSlug(), brand.slug)` active-org pinning with a
  `requireBrandAdmin`-gated probe against the **viewed** brand; on reject redirect to
  sign-in (anonymous) or portal landing/not-authorized (non-admin member). Removes the
  active-org-vs-viewed-brand bounce dance. Add a live client re-check.
- **`routes/sprout-admin.tsx`** — already two-stage; keep. With (a) the client `user`
  converges reliably so the `useEffect` bounce fires correctly.

**(c) Sign-out via a kit/guestlist auth client.**
Create **`workers/sprout/src/lib/auth-client.ts`** mirroring
`workers/identity/src/lib/auth-client.ts`:

```ts
import { createGuestlistAuthClient } from "@greenroom/guestlist-service/client/react";
const baseURL = typeof window !== "undefined" ? window.location.origin : import.meta.env.SPROUT_URL;
export const authClient = createGuestlistAuthClient({ baseURL }).auth;
```

Sprout proxies `/api/*` to guestlist over the binding (`routes/api/$.ts`), so
`authClient.signOut()` posts `/api/auth/sign-out` with the correct JSON content-type
through better-auth's client (no raw fetch, no 415). Wire `onSignOut` at all
`HeaderUserMenu` callsites (`hub.tsx`, `sprout-admin.tsx`, and the `_portal` header if it
gains a menu):

```tsx
onSignOut={async () => { await authClient.signOut(); window.location.href = "/"; }}
```

**Remove the raw-fetch fallback in `packages/ui/.../header-user-menu.tsx`.** `packages/ui`
is shared and must not depend on an app auth client, so make `onSignOut` the required
path: change the default handler to a dev-only `console.warn` no-op (or make the prop
required). Every real callsite now passes `onSignOut` backed by the client, so the raw
fetch becomes dead code.

### D5 · Remove the `activeOrgId`-as-tenant assumption wholesale

- All 118 `context.principal.activeOrgId` tenant reads → `context.brand.id`.
- **No** `setActiveOrganization` sync on portal entry.
- `loadActiveOrgInfo` (`session.functions.ts`) and `getActiveOrgBrandSlug`
  (`brand.functions.ts`) exist only to drive admin active-org pinning; once `admin.tsx`
  switches to `requireBrandAdmin` against the viewed brand, both are dead — delete them
  with `adminBrandRedirectSlug` (`brand-resolution.ts`). Redirect the three section
  consumers of `loadActiveOrgInfo` (`ContactSection.tsx:100`, `ChatSection.tsx:106`,
  `feed/PostOverlay.tsx:166`) to read `context.brand` instead.
- `getActiveOrgId` stays in kit (`platform-start-app.ts`) for other forks; Sprout stops
  importing it.
- `context.principal.activeOrgId` remains on the raw principal for genuinely cross-brand
  / observability uses, but **no brand-scoped handler reads it** after the refactor.

---

## Blast-radius inventory

Grouped by file. `Gate` = required middleware. `Scope-by` is always `context.brand.id`
unless noted. `xBrand` = cross-brand risk. Line numbers are from the verified audit; the
converter must re-anchor by fn name if lines drift. **Convert rule:** replace _every_
`activeOrgId` in the fn (outer gate, by-id WHERE, INSERT stamp, UPDATE guard, audit,
`emitEvent` brandId, roadie `permissionScope`, `roomName()`) with `context.brand.id`, and
grep the file afterward to prove no residual `activeOrgId` scoping remains.

### `workers/sprout/src/lib/landing.functions.ts`

| Line    | Fn                       | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------ | ---- | ----- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 46      | `listHeroSlides`         | GET  | read  | **public** (reference) | no     | Already scopes by viewed brand (`resolveBrandBySlug`→`brand.orgId`) + `permissionScope: brand:${brand.orgId}`. Route brand resolution through the shared resolver; **move behind `requireBrandAudience`** per audience-only (D4b) OR keep public as a deliberate exception. Do NOT convert to activeOrgId. |
| 117/120 | `listActiveBanners`      | GET  | read  | `requireBrandAudience` | yes    | **critical** empty banner rail. Scope `bannerCards.brandId` (L142). Keep dismissal LEFT JOIN on `actor.id`. Delete `if(!brandId) return []`.                                                                                                                                                               |
| 174/178 | `recordBannerImpression` | POST | write | `requireBrandAudience` | yes    | Scope UPDATE guard (L186) + `emitEvent` brandId (L189); keep AND `bannerId`.                                                                                                                                                                                                                               |
| 208/212 | `recordBannerClick`      | POST | write | `requireBrandAudience` | yes    | Scope UPDATE guard (L220) + `emitEvent` (L223).                                                                                                                                                                                                                                                            |
| 242/245 | `dismissBanner`          | POST | write | `requireBrandAudience` | yes    | **No brand check today.** Before INSERT, verify `bannerId` belongs to `context.brand.id` (SELECT `bannerCards WHERE id=bannerId AND brandId=context.brand.id`, else no-op).                                                                                                                                |

### `workers/sprout/src/lib/drops.functions.ts`

| Line    | Fn                   | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                         |
| ------- | -------------------- | ---- | ----- | ---------------------- | ------ | ----------------------------------------------------------------------------------------------------------- |
| 215     | `listLineup`         | GET  | read  | `requireBrandAudience` | yes    | **critical** "no product scroll". Scope products (L229), drops (L240), reviews (L254). Delete empty branch. |
| 286/290 | `getProduct`         | GET  | read  | `requireBrandAudience` | yes    | **critical** by-id. Scope all 3 subqueries + `emitEvent` (L332). Keep compound `and(eq(id),eq(brandId))`.   |
| 377/381 | `listProductContent` | GET  | read  | `requireBrandAudience` | yes    | Scope product check (L391), decks (L411), posts (L428).                                                     |
| 451/454 | `listAdminProducts`  | GET  | read  | `requireBrandAdmin`    | yes    | **critical**. Gate + products WHERE (L462).                                                                 |
| 524/528 | `upsertProduct`      | POST | write | `requireBrandAdmin`    | yes    | **critical**. INSERT stamp (L592), UPDATE guard (L574), audit (L578/615).                                   |
| 631/635 | `archiveProduct`     | POST | write | `requireBrandAdmin`    | yes    | **critical**. UPDATE guard (L644–649) + audit.                                                              |
| 680/684 | `upsertDrop`         | POST | write | `requireBrandAdmin`    | yes    | **critical**. Product-ownership SELECT (L694), drops INSERT (L702), audit.                                  |

### `workers/sprout/src/lib/banners.functions.ts`

| Line    | Fn                 | HTTP | R/W   | Gate                | xBrand | Fix                                                           |
| ------- | ------------------ | ---- | ----- | ------------------- | ------ | ------------------------------------------------------------- |
| 177/180 | `listAdminBanners` | GET  | read  | `requireBrandAdmin` | yes    | **critical**. Gate + WHERE (L189).                            |
| 201/204 | `getBannerReport`  | GET  | read  | `requireBrandAdmin` | yes    | **critical** by-id report. WHERE (L220).                      |
| 263/267 | `upsertBanner`     | POST | write | `requireBrandAdmin` | yes    | **critical**. INSERT (L317), UPDATE guard (L300), audit.      |
| 350/354 | `deleteBanner`     | POST | write | `requireBrandAdmin` | yes    | **critical** hard DELETE (L362, cascades dismissals) + audit. |

### `workers/sprout/src/lib/feed.functions.ts`

| Line    | Fn                    | HTTP | R/W   | Gate                                                                  | xBrand | Fix                                                                                                                                                                  |
| ------- | --------------------- | ---- | ----- | --------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 231/234 | `listFeed`            | GET  | read  | `requireBrandAudience`                                                | yes    | **critical** empty "Enter the Grow". Scope posts (L242); media/likes follow post ids.                                                                                |
| 279/283 | `getPost`             | GET  | read  | `requireBrandAudience`                                                | yes    | **critical** by-id. Post guard (L292) is the tenancy gate for postId-only child queries → must be viewed brand. `emitEvent` (L337).                                  |
| 361/365 | `getPostMediaReadUrl` | GET  | read  | `requireBrandAudience`                                                | yes    | Ownership join (L377) + roadie `permissionScope` (L390).                                                                                                             |
| 448/452 | `registerPostMedia`   | POST | write | `requireBrandAdmin`                                                   | yes    | Gate only (no D1 brand row); createPost re-gates.                                                                                                                    |
| 509/513 | `createPost`          | POST | write | `requireBrandAdmin`                                                   | yes    | **critical**. Product check (L527), `brand_team` from viewed-brand role (L534), posts INSERT (L554), audit.                                                          |
| 599/603 | `deletePost`          | POST | write | `requireBrandAdmin`                                                   | yes    | **critical**. Post guard (L612), UPDATE (L623), audit, **`roomName()` (L635)**.                                                                                      |
| 653/657 | `likePost`            | POST | write | `requireBrandAudience`                                                | yes    | Post lookup (L666) + both counters (L688/702) + `emitEvent` (L705). No fanout.                                                                                       |
| 730/734 | `addComment`          | POST | write | `requireBrandAudience`                                                | yes    | Post guard (L744), comment INSERT (L761), `brand_team` (L749), counter (L776/780), `emitEvent` (L783), **`roomName()` (L792)**.                                      |
| 830/835 | `heartComment`        | POST | write | `requireBrandAudience`                                                | yes    | Comment lookup (L844), counters (L876/887), **`roomName()` (L892)**.                                                                                                 |
| 911/915 | `deleteComment`       | POST | mixed | `requireBrandAudience` (own) / `requireBrandAdmin` (admin-any branch) | yes    | Comment guard (L924), posts refresh (L950/958/982), audit (L985), **`roomName()` (L996)**. Admin-any branch (L939) must `decideBrandAdmin` against **viewed** brand. |

### `workers/sprout/src/lib/decks.functions.ts`

| Line    | Fn                   | HTTP | R/W   | Gate                   | xBrand | Fix                                                                              |
| ------- | -------------------- | ---- | ----- | ---------------------- | ------ | -------------------------------------------------------------------------------- |
| 94      | `listDecks`          | GET  | read  | `requireBrandAudience` | yes    | Scope `decks.brandId`. Delete empty branch.                                      |
| 140/144 | `getDeckReadUrl`     | GET  | mixed | `requireBrandAudience` | yes    | `loadOwnedDeck(deckId, brand.id)`, `emitEvent`, roadie `permissionScope` (L168). |
| 189/193 | `getDeckCoverUrl`    | GET  | read  | `requireBrandAudience` | yes    | Row lookup + `permissionScope` (L210).                                           |
| 232     | `recordFlipDepth`    | POST | write | `requireBrandAudience` | yes    | `loadOwnedDeck` + `deckProgress.brandId` + `emitEvent`.                          |
| 288     | `recordDeckDownload` | POST | write | `requireBrandAudience` | yes    | `loadOwnedDeck` + `emitEvent`.                                                   |
| 351     | `registerDeckUpload` | POST | write | `requireBrandAdmin`    | yes    | INSERT `decks.brandId` + audit.                                                  |
| 431     | `finalizeDeckUpload` | POST | write | `requireBrandAdmin`    | yes    | Ownership + UPDATE + **queue payload brandId** + audit.                          |
| 503     | `upsertDeckMeta`     | POST | write | `requireBrandAdmin`    | yes    | UPDATE guard + audit.                                                            |
| 543     | `archiveDeck`        | POST | write | `requireBrandAdmin`    | yes    | UPDATE guard + audit.                                                            |
| 575     | `listAdminDecks`     | GET  | read  | `requireBrandAdmin`    | yes    | Gate + SELECT.                                                                   |

### `workers/sprout/src/lib/quizzes.functions.ts`

| Line | Fn                     | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                           |
| ---- | ---------------------- | ---- | ----- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| 627  | `listQuizzes`          | GET  | read  | `requireBrandAudience` | yes    | Visibility clause `brand_id IS NULL OR = brand.id` (public OR viewed). Keep per-user subqueries on `user_id`. |
| 681  | `listOpenAttempts`     | GET  | read  | `requireBrandAudience` | yes    | Visibility uses `brand.id`.                                                                                   |
| 769  | `startAttempt`         | POST | write | `requireBrandAudience` | yes    | `loadTakeableQuiz(quizId, brand.id)` + `emitEvent`.                                                           |
| 893  | `resumeAttempt`        | GET  | read  | `requireBrandAudience` | yes    | `loadTakeableQuiz(attempt.quiz_id, brand.id)` after owner-scope.                                              |
| 955  | `saveProgress`         | POST | write | `requireBrandAudience` | no     | Owner-only today; **attach the gate** so caller is verified audience. Keep `user_id` scope.                   |
| 996  | `gradeAttempt`         | POST | write | `requireBrandAudience` | yes    | `loadTakeableQuiz(..., brand.id)` + `emitEvent` fallback.                                                     |
| 1173 | `getAttemptResult`     | GET  | read  | `requireBrandAudience` | yes    | `loadTakeableQuiz(..., brand.id)`.                                                                            |
| 1270 | `listMyCertifications` | GET  | read  | `requireBrandAudience` | yes    | `certifications.brandId = brand.id`.                                                                          |
| 1388 | `listAdminQuizzes`     | GET  | read  | `requireBrandAdmin`    | yes    | Gate + SELECT.                                                                                                |
| 1409 | `getAdminQuiz`         | GET  | read  | `requireBrandAdmin`    | yes    | Exposes answer keys — scope quiz + questions/options ownership.                                               |
| 1494 | `upsertQuiz`           | POST | write | `requireBrandAdmin`    | yes    | INSERT/UPDATE + `loadOwnedQuiz` + audit.                                                                      |
| 1597 | `upsertQuestion`       | POST | write | `requireBrandAdmin`    | yes    | Ownership joins + updated_at guard + audit.                                                                   |
| 1730 | `upsertOption`         | POST | write | `requireBrandAdmin`    | yes    | Ownership join + audit.                                                                                       |
| 1818 | `deleteQuestion`       | POST | write | `requireBrandAdmin`    | yes    | Ownership join + updated_at guard + audit.                                                                    |
| 1862 | `publishQuiz`          | POST | write | `requireBrandAdmin`    | yes    | `loadOwnedQuiz` + UPDATE guard + audit.                                                                       |

### `workers/sprout/src/lib/reviews.functions.ts`

| Line | Fn                 | HTTP | R/W   | Gate                   | xBrand | Fix                                                       |
| ---- | ------------------ | ---- | ----- | ---------------------- | ------ | --------------------------------------------------------- |
| 99   | `listReviews`      | GET  | read  | `requireBrandAudience` | yes    | `reviews.brandId = brand.id`; by-productId.               |
| 175  | `upsertMyReview`   | POST | write | `requireBrandAudience` | yes    | Product check + INSERT + ON CONFLICT tuple + `emitEvent`. |
| 246  | `deleteMyReview`   | POST | write | `requireBrandAudience` | yes    | DELETE guard `brandId=brand.id` (keep `userId`).          |
| 294  | `deleteReview`     | POST | write | `requireBrandAdmin`    | yes    | Target lookup + DELETE + audit.                           |
| 342  | `listAdminReviews` | GET  | read  | `requireBrandAdmin`    | yes    | Gate + SELECT.                                            |

### `workers/sprout/src/lib/assets.functions.ts`

| Line    | Fn                    | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                 |
| ------- | --------------------- | ---- | ----- | ---------------------- | ------ | --------------------------------------------------------------------------------------------------- |
| 150/153 | `listAssets`          | GET  | read  | `requireBrandAudience` | yes    | `eq(assets.brandId, brand.id)`. Delete empty branch.                                                |
| 195/199 | `getAssetReadUrl`     | GET  | read  | `requireBrandAudience` | yes    | `loadOwnedAsset(assetId, brand.id)` + `permissionScope` (L209). By-id filter moves to viewed brand. |
| 230/234 | `getAssetThumbUrl`    | GET  | read  | `requireBrandAudience` | yes    | Lookup + `permissionScope` (L247).                                                                  |
| 262/266 | `recordDownload`      | POST | mixed | `requireBrandAudience` | yes    | Member action (NOT admin). UPDATE (L277) + `emitEvent` (L279–286).                                  |
| 332/336 | `registerAssetUpload` | POST | write | `requireBrandAdmin`    | yes    | Gate + INSERT stamp (L375).                                                                         |
| 411/415 | `finalizeAssetUpload` | POST | write | `requireBrandAdmin`    | yes    | Ownership SELECT (L425) + UPDATE (L444).                                                            |
| 472/476 | `upsertAssetMeta`     | POST | write | `requireBrandAdmin`    | yes    | UPDATE guard (L495).                                                                                |
| 521/525 | `archiveAsset`        | POST | write | `requireBrandAdmin`    | yes    | UPDATE guard (L536).                                                                                |
| 557/560 | `listAdminAssets`     | GET  | read  | `requireBrandAdmin`    | yes    | Gate + SELECT (L568). Admin-only read.                                                              |

### `workers/sprout/src/lib/brand.functions.ts`

| Line    | Fn                       | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                                                    |
| ------- | ------------------------ | ---- | ----- | ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 45      | `getBrandForHost`        | GET  | read  | **public** (reference) | no     | No change. Cosmetic skin via `resolveBrandBySlug`. Reuse its slug path in the resolver.                                                |
| 57      | `getActiveOrgBrandSlug`  | GET  | read  | n/a                    | no     | **DELETE** after `admin.tsx` switches to viewed-brand gate (D5). Only used for active-org pinning.                                     |
| 83      | `selectBrand`            | POST | write | **public**             | yes    | Keep public (skin selection). Safe _only because_ every viewed-brand read/write now enforces the audience gate. Document the coupling. |
| 113/116 | `getBrandConfig`         | GET  | read  | `requireBrandAdmin`    | yes    | **Ungated admin read today** (only `requireUserMiddleware`). Add gate + `orgId=brand.id` (L132).                                       |
| 175/178 | `getAdminBrandConfig`    | GET  | read  | `requireBrandAdmin`    | yes    | Ungated today. Add gate + `orgId=brand.id` (L197).                                                                                     |
| 235/238 | `getAdminDashboardStats` | GET  | read  | `requireBrandAdmin`    | yes    | Ungated today. Add gate + scope counts (L259/265/271).                                                                                 |
| 364/368 | `updatePortalSetup`      | POST | write | `requireBrandAdmin`    | yes    | Upsert `orgId=brand.id` (L385/393).                                                                                                    |
| 434/438 | `updateSections`         | POST | write | `requireBrandAdmin`    | yes    | Upsert `orgId=brand.id` (L466/473).                                                                                                    |
| 500/503 | `flipDraftToLive`        | POST | write | `requireBrandAdmin`    | yes    | Exists-check (L513) + UPDATE (L528).                                                                                                   |
| 588/591 | `listAdminHeroSlides`    | GET  | read  | `requireBrandAdmin`    | yes    | SELECT (L599) + roadie `permissionScope` (L613).                                                                                       |
| 660/664 | `registerHeroUpload`     | POST | write | `requireBrandAdmin`    | yes    | max-order (L708) + INSERT (L714).                                                                                                      |
| 748/752 | `finalizeHeroSlide`      | POST | write | `requireBrandAdmin`    | yes    | Ownership SELECT (L762) + UPDATE (L779).                                                                                               |
| 805/809 | `upsertHeroSlide`        | POST | write | `requireBrandAdmin`    | yes    | UPDATE guard (L821).                                                                                                                   |
| 851/855 | `reorderHeroSlides`      | POST | write | `requireBrandAdmin`    | yes    | Owned-set (L865) + per-row UPDATE (L896).                                                                                              |
| 922/926 | `deleteHeroSlide`        | POST | write | `requireBrandAdmin`    | yes    | DELETE (L934) + renumber (L950).                                                                                                       |

### `workers/sprout/src/lib/recordings.functions.ts`

| Line    | Fn                 | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                  |
| ------- | ------------------ | ---- | ----- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 62/65   | `listRecordings`   | GET  | read  | `requireBrandAudience` | yes    | SELECT (L82). Delete empty branch.                                                                   |
| 111/115 | `getRecordingUrl`  | GET  | read  | `requireBrandAudience` | yes    | Ownership SELECT (L127) + `permissionScope` (L139).                                                  |
| 166/170 | `archiveRecording` | POST | write | `requireBrandAdmin`    | yes    | System/egress write — gate as admin (or move to service/webhook principal). UPDATE guard (L178–184). |

### `workers/sprout/src/lib/chat.functions.ts`

| Line    | Fn               | HTTP | R/W   | Gate                                                               | xBrand | Fix                                                                                                                                                  |
| ------- | ---------------- | ---- | ----- | ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 123/126 | `ensureRoom`     | POST | write | `requireBrandAudience`                                             | yes    | `ensureRoomId(brand.id)` — DO is `idFromName(brandId)`, MUST be viewed brand.                                                                        |
| 144/148 | `getRoomHistory` | GET  | read  | `requireBrandAudience`                                             | yes    | WHERE `chatMessages.brandId=brand.id` (L160/164).                                                                                                    |
| 203/207 | `sendMessage`    | POST | write | `requireBrandAudience`                                             | yes    | INSERT (L224), `emitEvent` (L237), **`roomName()` fanout (L247)**, team marker from `context.brand.role` (NOT `getCallerOrgRole(activeOrgId)` L215). |
| 288/292 | `deleteMessage`  | POST | mixed | `requireBrandAudience` + admin-branch `decideBrandAdmin(brand.id)` | yes    | Lookup (L301), UPDATE (L321), audit, **`roomName()` (L338)**. Move admin escalation (L309) to viewed brand.                                          |

### `workers/sprout/src/lib/contact.functions.ts`

| Line    | Fn              | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                                |
| ------- | --------------- | ---- | ----- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| 210/214 | `sendContact`   | POST | write | `requireBrandAudience` | yes    | INSERT `brandId=brand.id` (L223); `user_id` stays actor.                                                           |
| 248     | `listMyThreads` | GET  | read  | `requireBrandAudience` | yes    | WHERE `brandId=brand.id AND userId` (L259).                                                                        |
| 301/305 | `listInbox`     | GET  | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L311/312).                                                                                           |
| 347/351 | `replyContact`  | POST | write | `requireBrandAdmin`    | yes    | **critical**. Thread lookup (L365), status (L385), notify (L389), audit (L399). Admin check moves to viewed brand. |

### `workers/sprout/src/lib/requests.functions.ts`

| Line    | Fn                     | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                  |
| ------- | ---------------------- | ---- | ----- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| 206/210 | `requestPhysical`      | POST | write | `requireBrandAudience` | yes    | Asset gate (L223) + INSERT (L242).                                                                   |
| 277     | `listMyRequests`       | GET  | read  | `requireBrandAudience` | yes    | WHERE `brandId=brand.id AND userId` (L289).                                                          |
| 321/325 | `listFulfilmentQueue`  | GET  | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L331/332) + roadie `permissionScope` (L351).                                           |
| 409/413 | `decideFulfilment`     | POST | write | `requireBrandAdmin`    | yes    | **critical**. Lookup (L430), UPDATE (L441), audit (L445), notify (L455). Admin check → viewed brand. |
| 491/495 | `registerDisplayProof` | POST | write | `requireBrandAudience` | yes    | Lookup `brandId=brand.id AND userId` (L504–509).                                                     |
| 556/560 | `confirmDeployed`      | POST | write | `requireBrandAudience` | yes    | Lookup (L577), UPDATE (L603), audit (L605), by `brand.id AND userId`.                                |

### `workers/sprout/src/lib/sessions.functions.ts`

| Line    | Fn                         | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                   |
| ------- | -------------------------- | ---- | ----- | ---------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| 126     | `listSlots`                | GET  | read  | `requireBrandAudience` | yes    | availabilityWindows (L146) + booked-set (L158).                                                       |
| 187     | `listMyBookings`           | GET  | read  | `requireBrandAudience` | yes    | WHERE `brandId=brand.id AND userId` (L207).                                                           |
| 224     | `listGroupSessions`        | GET  | read  | `requireBrandAudience` | yes    | groupSessions (L244); attendance follows ids.                                                         |
| 304/308 | `bookCall`                 | POST | write | `requireBrandAudience` | yes    | Window lookup (L326), INSERT (L345), `emitEvent` (L365).                                              |
| 385     | `cancelBooking`            | POST | write | `requireBrandAudience` | yes    | UPDATE `brandId=brand.id AND userId` (L400).                                                          |
| 421/425 | `registerSession`          | POST | write | `requireBrandAudience` | yes    | Session lookup (L437) + attendance INSERT (L476).                                                     |
| 507/511 | `joinSession`              | POST | write | `requireBrandAudience` | yes    | Lookup (L529), `createRealtimeSession({brandId})` (L559), realtime update (L569), `emitEvent` (L585). |
| 610     | `leaveSession`             | POST | write | `requireBrandAudience` | yes    | Attendance lookup/update `brandId=brand.id AND userId` (L630).                                        |
| 675/678 | `listAdminWindows`         | GET  | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L695).                                                                                  |
| 715/718 | `listAdminGroupSessions`   | GET  | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L738).                                                                                  |
| 774/778 | `upsertAvailabilityWindow` | POST | write | `requireBrandAdmin`    | yes    | **critical**. INSERT (L819)/UPDATE (L803) + audit. Admin check → viewed brand.                        |
| 862/866 | `upsertGroupSession`       | POST | write | `requireBrandAdmin`    | yes    | **critical**. INSERT (L906)/UPDATE (L891) + audit. Admin check → viewed brand.                        |

### `workers/sprout/src/lib/ai.functions.ts`

| Line    | Fn                   | HTTP  | R/W   | Gate                   | xBrand | Fix                                                                                                                             |
| ------- | -------------------- | ----- | ----- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 301/305 | `askAssistant`       | POST  | mixed | `requireBrandAudience` | yes    | `retrieve(brand.id)` (L323) — Vectorize `brand_id` filter, embeddings, custom_qa; `aiQaLog` INSERT (L351) + `emitEvent` (L363). |
| 402/405 | `listCustomQa`       | GET   | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L420).                                                                                                            |
| 438/442 | `addCustomQA`        | POST  | write | `requireBrandAdmin`    | yes    | INSERT (L473)/UPDATE (L457) + audit + **`reindexSource(brand.id, …)` (L468/492)**.                                              |
| 503/507 | `setCustomQaEnabled` | POST  | write | `requireBrandAdmin`    | yes    | UPDATE (L516) + audit + **`reindexSource(brand.id)` (L527)**.                                                                   |
| 540/544 | `listQaLog`          | GET   | read  | `requireBrandAdmin`    | yes    | Gate + WHERE (L563).                                                                                                            |
| 581     | `reindexSource`      | infra | n/a   | n/a (helper)           | yes    | No gate. Correctness = callers pass `brand.id`. Audit all importers (content/deck/asset publish streams).                       |

### `workers/sprout/src/lib/analytics.functions.ts`

| Line | Fn                        | HTTP | R/W  | Gate                   | xBrand | Fix                                                                                                                                            |
| ---- | ------------------------- | ---- | ---- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 66   | `getBudtenderReport`      | GET  | read | `requireBrandAudience` | yes    | Scope by `brand.id`; reject non-members. **Also:** restrict client-supplied `actorId` (L67/86) — only brand admins may read `actorId != self`. |
| 291  | `getBudtenderMatrix`      | GET  | read | `requireBrandAdmin`    | yes    | Rows + admin check → viewed brand.                                                                                                             |
| 403  | `getDeckStats`            | GET  | read | `requireBrandAdmin`    | yes    | Rows + admin check → viewed brand.                                                                                                             |
| 497  | `getProductStats`         | GET  | read | `requireBrandAdmin`    | yes    | Rows + admin check → viewed brand.                                                                                                             |
| 619  | `getQuizStats`            | GET  | read | `requireBrandAdmin`    | yes    | Rows + admin check → viewed brand.                                                                                                             |
| 694  | `getAiQuestionStats`      | GET  | read | `requireBrandAdmin`    | yes    | Rows + admin check → viewed brand.                                                                                                             |
| 740  | `exportCsv` (all 5 views) | GET  | read | `requireBrandAdmin`    | yes    | Pass `brand.id` to every `*Rows` helper; gate → viewed brand.                                                                                  |

### `workers/sprout/src/lib/hub.functions.ts` (cross-brand — mostly DO NOT convert)

| Line    | Fn                                                                                                | HTTP  | R/W   | Gate                                                                | xBrand | Fix                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------------------------------------------------------- | ----- | ----- | ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 78      | `getLeaderboard`                                                                                  | GET   | read  | `requireBrandAudience`                                              | no     | **Only activeOrgId-scoped fn here.** Scope top-N (L96) + own-rank (L123/142) by `brand.id`.                                                                                                                                                                           |
| 601/604 | `syncOrgDirectory`                                                                                | POST  | write | **platform-admin** (`requireAdminMiddleware`) or service credential | yes    | **critical**. Currently any user can UPSERT any brand's directory row. Restrict to platform/service principal.                                                                                                                                                        |
| 538     | `requestAccess`                                                                                   | POST  | write | keep `requireUserMiddleware`                                        | no     | Self-enqueue. Optional low-pri: validate `brandId` exists/joinable.                                                                                                                                                                                                   |
| 315+    | `listMyPortals` / `listJoinableBrands` / `getFeaturedBrand` / `getUnreadCounts` / `approveAccess` | mixed | mixed | keep as-is                                                          | no     | **Reference (do NOT convert).** Scope by caller memberships / target brand. `approveAccess` (L638) is the `requireBrandAdmin`-against-target template. `resolveLogoUrl` (L300) `permissionScope: brand:${brandId}` stays keyed to the directory brand (public logos). |

### `workers/sprout/src/lib/portal.functions.ts`

| Line | Fn               | HTTP | R/W   | Gate                   | xBrand | Fix                                                                                                                                |
| ---- | ---------------- | ---- | ----- | ---------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 28   | `getMyOrgRole`   | GET  | read  | `requireBrandAudience` | no     | Return `context.brand.role`; drop the `activeOrgId === viewed` gate. Consumed by `_portal` Admin link.                             |
| 52   | `getMyBrandRole` | GET  | mixed | `requireBrandAudience` | yes    | Lazy org→portal sync moves into resolver; return `context.brand.role`. Fold org staff on any confirmed membership of viewed brand. |
| 75   | `getHostSlug`    | GET  | read  | **public** (reference) | no     | No change. Pre-auth slug echo, no tenant data.                                                                                     |

### `workers/sprout/src/lib/notifications.functions.ts`

| Line | Fn                                                                        | HTTP  | R/W   | Gate                   | xBrand | Fix                                                                                                                                                                      |
| ---- | ------------------------------------------------------------------------- | ----- | ----- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 330  | `setNotificationPref`                                                     | POST  | write | `requireBrandAudience` | no     | **Excludes budtenders today** (`getCallerOrgRole` only → null → forbidden). Accept portal-member OR org-member OR platform-admin (the audience predicate) before upsert. |
| 172+ | `listNotifications` / `markRead` / `markAllRead` / `getNotificationPrefs` | mixed | mixed | keep as-is             | no     | **Reference (do NOT convert).** User-scoped; correct.                                                                                                                    |

### `workers/sprout/src/lib/session.functions.ts`

| Line | Fn                  | HTTP | R/W  | Gate | xBrand | Fix                                                                                                                                                 |
| ---- | ------------------- | ---- | ---- | ---- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7    | `loadSession`       | GET  | read | n/a  | no     | SSR seed source. Thread `context.brand` through its payload (or sibling loader) so SSR and client agree. Staleness fix lives in kit provider (D4a). |
| 24   | `loadActiveOrgInfo` | GET  | read | n/a  | yes    | **DELETE** after refactor; redirect chrome consumers (`ContactSection:100`, `ChatSection:106`, `PostOverlay:166`) to `context.brand`.               |

### `workers/sprout/src/lib/*.functions.ts` — audited clean (DO NOT convert)

| File                        | Fns                                                                                                                 | Note                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `award.functions.ts`        | `getPlatformLeaderboard` / `getAward` / `getLastMonthWinner`                                                        | Scope by `callerBrands(userId)` (org∪portal). Correct.                                                 |
| `credentials.functions.ts`  | `getMyCredential` / `registerCredentialUpload` / `submitCredential` / `listPendingCredentials` / `reviewCredential` | Per-user + platform-admin. CanSell cert is platform-wide by design. `permissionScope: user:${userId}`. |
| `sprout-admin.functions.ts` | `listBrands` / `provisionOrg` / `getSystemHealth` / `getCrossBrandStats`                                            | Platform-admin god-mode; intentionally cross-brand.                                                    |

### Routes / client / realtime / infra

| File:Line                                                | Surface                                                     | Fix                                                                                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `routes/_portal.tsx:34`                                  | loader                                                      | Resolve+authorize `context.brand` once; branch on membership; children scope by `brand.id`; remove empty-data fallback. |
| `routes/_portal/index.tsx`                               | `listHeroSlides` mount                                      | Move behind `requireBrandAudience` (audience-only).                                                                     |
| `routes/hub.tsx:25`                                      | `beforeLoad`                                                | Two-stage: SSR bounce for absent session + live re-check via `authClient.useSession()` (D4a).                           |
| `routes/hub.tsx:58`                                      | `HeaderUserMenu`                                            | Add `onSignOut` via auth client.                                                                                        |
| `routes/admin.tsx:53`                                    | `beforeLoad`                                                | Replace active-org pinning with `requireBrandAdmin`(viewed brand); add live re-check via `authClient.useSession()` (D4a). |
| `routes/sprout-admin.tsx:82-89`                          | two-stage check                                             | Swap existing `useAuth()`-based live check to `authClient.useSession()` (D4a).                                          |
| `routes/sprout-admin.tsx:146`                            | `HeaderUserMenu`                                            | Add `onSignOut` via auth client.                                                                                        |
| `components/admin/DemoMode.tsx:81/164/192`               | `getAdminBrandConfig`/`updatePortalSetup`/`flipDraftToLive` | Operates on active org; must target the previewed brand via `requireBrandAdmin`(brand.id).                              |
| `room-server.ts:118`                                     | `GroupChatRoom.onConnect`                                   | **critical** — see Realtime verdicts.                                                                                   |
| `routes/ws/$.ts:16`                                      | upgrade                                                     | No change; trust delegated to `onConnect`.                                                                              |
| `lib/room.ts:10`                                         | `roomName`/`fanoutToRoom`/`getRoomOnline`                   | No change to helper; every call site passes `brand.id`. Grep `roomName(` / `getRoomOnline(`.                            |
| `lib/brand-resolution.ts:53`                             | `resolveBrandSlug` (path cookie)                            | No change; safe only because gates enforce membership. Document coupling.                                               |
| `lib/brand-resolution.ts:88`                             | `adminBrandRedirectSlug`                                    | **DELETE** with its tests once `/admin` gates by viewed brand.                                                          |
| `routes/api/$.ts:19`                                     | proxy                                                       | No change; the sign-out edge (guestlist owns auth globally).                                                            |
| `packages/kit/src/react-start/auth-provider.tsx`         | `AuthProvider`                                              | **No change (D4a decision).** Stays SSR-seed-once; superseded by per-route `authClient.useSession()` below, not a shared kit patch. |
| `packages/kit/src/react-start/platform-start-app.ts:210` | `getSession`                                                | Still real (feeds `ssrSession` via `loadSession`), but lower-urgency post-D4a: `liveSession ?? ssrSession` mostly papers over a transient RPC-throw since `authClient.useSession()` hits guestlist independently. Fix opportunistically: base SSR guard on the same verified envelope, or make RPC failure distinguishable from unauthenticated. |
| `packages/ui/.../header-user-menu.tsx:30`                | `handleSignOut`                                             | Remove raw-fetch fallback; require `onSignOut`.                                                                         |
| `jobs/queue.ts`                                          | `handleDeckDeriveJob`/`handleEmbedJob`/`loadEmbedText`      | Payload-scoped system principal — no gate change, but **fix enqueue sites** + **backfill** (see Data migration).        |
| `jobs/cron.ts`                                           | `handleCron`                                                | **Audited clean.** Row-scoped system writer. No change.                                                                 |

---

## Cross-brand-by-id checks (item.brandId === context.brand.id)

Every fn that accepts a client-supplied id must keep the brand filter **in the same
`WHERE`** as the id lookup — never fetch by id alone then trust `row.brandId`. A forged id
from another brand must resolve to "not found." Add this to the review checklist for all
20 write handlers and every `loadOwned*` helper. Explicit by-id sites (all already
compound today — preserve the invariant, only swap `activeOrgId → context.brand.id`):

- `drops.getProduct` (L290), `drops.listProductContent` (L381), `drops.upsertProduct`
  (product UPDATE L574), `drops.upsertDrop` (product-ownership SELECT L694)
- `decks.getDeckReadUrl` (L201 verified), `decks.getDeckCoverUrl` (L189),
  `decks.finalizeDeckUpload`/`upsertDeckMeta`/`archiveDeck` (ownership+UPDATE)
- `assets.getAssetReadUrl` (`loadOwnedAsset` L180/202), `getAssetThumbUrl` (L237),
  `finalizeAssetUpload` (L425/444), `upsertAssetMeta` (L495), `archiveAsset` (L536)
- `banners.getBannerReport` (L220), `upsertBanner` (UPDATE L300), `deleteBanner` (L362)
- `feed.getPost` (post guard L292 gates postId-only child queries — **must** be viewed
  brand), `getPostMediaReadUrl` (join L377), `deletePost`/`likePost`/`addComment`/
  `heartComment`/`deleteComment` (post/comment lookups)
- `quizzes.getAdminQuiz` (L1409), `startAttempt`/`resumeAttempt`/`gradeAttempt`/
  `getAttemptResult` (`loadTakeableQuiz`), `upsertQuestion`/`upsertOption`/`deleteQuestion`
  (ownership joins), `publishQuiz`/`upsertQuiz` (`loadOwnedQuiz`)
- `reviews.upsertMyReview`/`deleteMyReview`/`deleteReview` (product/review lookups)
- `recordings.getRecordingUrl` (sessionId lookup L127)
- `sessions.bookCall` (window L326), `cancelBooking` (L400), `registerSession` (L437),
  `joinSession` (L529), `leaveSession` (L630), `upsertAvailabilityWindow`/`upsertGroupSession`
- `requests.decideFulfilment` (L430), `registerDisplayProof` (L504), `confirmDeployed`
  (L577), `requestPhysical` (asset L223)
- `contact.replyContact` (thread L365)
- `landing.dismissBanner` (bannerId — **add** the compound check; none today)
- `assets.recordDownload`, `decks.recordDeckDownload` (id + brand)

**Enforcement:** after conversion, `grep -n 'context.principal.activeOrgId' workers/sprout/src/lib`
must return zero brand-scoping hits (only genuinely cross-brand/observability uses may
remain, and none should in leaf `.functions.ts`).

---

## Realtime / edge verdicts

- **`room-server.ts` `GroupChatRoom.onConnect` (L118) — MUST move to viewed-brand
  audience (critical).** Keep the slug→`org_brand_directory.orgId` pin (L98) and the
  `dir.orgId === brandId` room-binding check. Replace
  `if (envelope.activeOrgId !== brandId) return reject("cross_brand")` (L118) with a
  **membership** check against the room's `brandId`: platform-admin OR
  `getPortalRole(brandId, userId)` OR org-member. The DO already holds
  `createDb(this.env.DB)`, so `getPortalRole` is a local query; because the audience gate
  lazily syncs org staff into `portal_members` on their first portal load, a **pure
  `portal_members` check in the DO is likely sufficient** and I/O-cheap (org-only
  fallback via a guestlist hop if needed). This gate also serves the feed-comments
  keyspace (`<brandId>:<postId>`) — migrate identically. The path-mode `sprout_brand`
  cookie is read off the upgrade headers (L83); acceptable because `dir.orgId` is then
  bound and admission requires membership of it.
- **`ChatSection.tsx` — no change beyond the server gate.** Already uses
  `room = brand.orgId` (viewed brand) with `prefix:"ws"`.
- **`routes/ws/$.ts` — no change.** Pure partyserver routing; the client path segment is
  passed to `idFromName` and the only defense is `onConnect` (fixed above). Document the
  delegation.
- **`lib/room.ts` — no change to the helper.** Systemic: every `roomName()` /
  `fanoutToRoom()` / `getRoomOnline()` call site passes `context.brand.id`. Sites:
  `feed.deletePost` L635, `feed.addComment` L792, `feed.heartComment` L892,
  `feed.deleteComment` L996, `chat.sendMessage` L247, `chat.deleteMessage` L338, plus hub
  presence "N online" reads. `likePost` has no realtime edge.
- **Roadie blob `permissionScope` — MUST switch `brand:${activeOrgId}` →
  `brand:${context.brand.id}`** at: `decks.getDeckReadUrl` (L168), `getDeckCoverUrl`
  (L210), `assets.getAssetReadUrl` (L209), `getAssetThumbUrl` (L247),
  `feed.getPostMediaReadUrl` (L390), `recordings.getRecordingUrl` (L139),
  `brand.listAdminHeroSlides` (L613), `requests.listFulfilmentQueue` (L351).
  `landing.listHeroSlides` already scopes by `brand.orgId` (correct-by-construction once
  behind the gate). Hub `resolveLogoUrl` (L300) stays keyed to the directory brand id
  (public logos) — leave it.

---

## Execution plan (ordered, checkable)

**Phase 0 — precondition**

- [ ] Verify better-auth `getActiveMemberRole({ query: { organizationId } })` scopes to
      the passed org (not session active org). Block the whole plan if it does not.

**Phase 1 — infra / gates (no behavior change yet)**

- [ ] Create `workers/sprout/src/lib/brand-context.server.ts` with `resolveViewedBrandFor`
  - `BrandStanding`/`ViewedBrand` types.
- [ ] Add `requireBrandAudience` and `requireBrandAdmin` to
      `workers/sprout/src/lib/middleware/auth.ts` (compose on `requireUserMiddleware`; expose
      `context.brand`).
- [ ] Unit-test the resolver + gates (Phase 8 tests can land here first, red).

**Phase 2 — per-file handler conversion** (one file per commit; grep-clean each before
committing — file-overlap is a real dependency, commit between files):

- [ ] `landing.functions.ts` → `drops.functions.ts` → `banners.functions.ts`
- [ ] `feed.functions.ts` (+ all four fanout sites) → `decks.functions.ts`
- [ ] `quizzes.functions.ts` → `reviews.functions.ts` → `assets.functions.ts`
- [ ] `brand.functions.ts` (add the 3 missing admin gates) → `recordings.functions.ts`
- [ ] `chat.functions.ts` → `contact.functions.ts` → `requests.functions.ts`
- [ ] `sessions.functions.ts` → `ai.functions.ts` (+ enqueue sites) →
      `analytics.functions.ts` (+ `actorId` restriction)
- [ ] `hub.functions.ts` — `getLeaderboard` convert; `syncOrgDirectory` → platform-admin
- [ ] `portal.functions.ts` — thin `getMyOrgRole`/`getMyBrandRole`
- [ ] `notifications.functions.ts` — `setNotificationPref` audience predicate
- [ ] After each file: `grep -n 'context.principal.activeOrgId'` returns no scoping hits.

**Phase 3 — realtime edge**

- [ ] `room-server.ts` onConnect → viewed-brand membership (both keyspaces).
- [ ] Confirm all `roomName()` call sites pass `context.brand.id` (grep).

**Phase 4 — dead-code removal**

- [ ] Delete `getActiveOrgBrandSlug`, `loadActiveOrgInfo`, `adminBrandRedirectSlug`
      (+ their tests). Redirect the 3 section chrome consumers to `context.brand`.

**Phase 5 — loaders / routes / client**

- [ ] Create `workers/sprout/src/lib/auth-client.ts` (pulled forward from Phase 6 —
      required by the `authClient.useSession()` swap below).
- [ ] `_portal.tsx`, `_portal/index.tsx`, `hub.tsx`, `admin.tsx`, `sprout-admin.tsx`
      per D4b. `DemoMode.tsx` → viewed-brand admin fns.
- [ ] Swap `hub.tsx` / `admin.tsx` / `sprout-admin.tsx` live re-checks to
      `authClient.useSession()` merged with `ssrSession` (D4a). **No kit package change.**
- [ ] Opportunistic: `platform-start-app.ts` getSession envelope basis (lower priority
      post-D4a, see blast-radius table).

**Phase 6 — sign-out**

- [ ] Wire `onSignOut` at every `HeaderUserMenu` callsite via `authClient.signOut()`.
- [ ] Remove raw-fetch fallback in `packages/ui/.../header-user-menu.tsx`.

**Phase 7 — data migration** (see Data-migration section)

- [ ] Fix enqueue sites (already in Phase 2 for ai; also `finalizeDeckUpload`).
- [ ] Backfill/re-embed mis-branded RAG corpus + re-derive deck covers.
- [ ] Decide + document analytics discontinuity (accept cutover, or backfill).

**Phase 8 — tests** (see Test requirements). Rewrite/​invert the two compliance suites.

**Phase 9 — verify + typecheck**

- [ ] `bun run check` from root (workspace-wide is the reference signal, not per-file).
- [ ] `bun run types` per touched service.
- [ ] E2E journeys (Phase 8).

---

## Data migration (persisted corpus written under the wrong brand)

Two persisted-data dimensions survive the code fix and need reconciliation:

1. **RAG / derive corpus (`jobs/queue.ts`) — high.** `handleEmbedJob` writes
   `ai_embeddings` rows + Vectorize vectors tagged `metadata.brand_id = <payload brand>`
   (vectorizeId `${brandId}:${sourceType}:${sourceId}`), and `handleDeckDeriveJob` signs
   the source blob `brand:${brandId}` and writes derived covers `WHERE decks.brandId=…`.
   Payload-scoping is correct, but every **enqueue** site currently passes `activeOrgId`:
   `finalizeDeckUpload` (deck payload), `addCustomQA`/`setCustomQaEnabled` → `reindexSource`
   (L468/492/527). So persisted vectors/embeddings/covers are tagged under the **wrong**
   brand and will be **missed** by `askAssistant`'s viewed-brand `brand_id` filter after
   the read fix. Actions: (a) fix enqueue sites to pass `context.brand.id`; (b) leave the
   consumer un-gated but documented as payload-trusting; (c) one-time backfill — delete +
   re-enqueue embeds for rows whose `ai_embeddings.brandId` / Vectorize `brand_id` was
   stamped from a stale active org, and re-derive deck covers. Grep
   `metadata: { brand_id` and `vectorizeId` to enumerate keys.

2. **Analytics / scores (`analytics_events`, `user_brand_scores`) — medium.** Every write
   fn's `emitEvent` stamped `analytics_events.brandId = activeOrgId`, and the nightly cron
   projects `user_brand_scores` off attempts/deck_progress whose `brand_id` was itself
   written under active org. Budtender events (null active org) were dropped entirely.
   After the fix, viewed-brand analytics/leaderboard reads show a discontinuity at the
   cutover. Action: decide (a) accept + document the cutover date, or (b) backfill
   `analytics_events.brandId` / `user_brand_scores` from the correct mapping where
   recoverable. No code gate — flagged so the plan owns the reconciliation.

---

## Test requirements

**Unit (gates / policy / resolver)**

- `resolveViewedBrandFor`: no-brand (apex) → `no-brand`; bogus slug → `unknown-brand`;
  portal-member → standing; org-staff (no portal row) → lazy-synced + role; non-member →
  `not-member`; platform-admin → `platform-admin`.
- `requireBrandAudience`: rejects non-member with `notFound`; passes member; runs
  envelope verify once when stacked under `requireBrandAdmin`.
- `requireBrandAdmin`: member-but-not-admin → `notFound`; owner/admin/platform-admin pass.
- `decideBrandAdmin` against a viewed-brand org role that differs from active org.

**Integration (vitest-pool-workers, real bindings — two seeded brands + a portal-only
budtender + a cross-brand admin)**

- Cross-brand rejection: member of A viewing B gets B's data or `notFound`, **never** A's,
  across a representative read, write, blob-sign, and analytics fn.
- Budtender on own brand (null `activeOrgId`) sees **populated** banners/lineup/feed/decks
  (regression for the empty-portal bug).
- Path-mode cookie tamper: setting `sprout_brand=<foreign brand>` yields `notFound` for a
  non-member; yields data only for a member.
- By-id forgery: a foreign-brand id passed to `getProduct`/`getDeckReadUrl`/`getAsset*`
  resolves to not-found (compound WHERE preserved).
- Stale-session redirect: valid envelope + failing guestlist RPC does not silently empty
  the portal.
- DO `onConnect`: admits a viewed-brand member (incl. budtender), rejects a non-member.

**E2E (`e2e/sprout/`)**

- Budtender-on-own-brand: signs in, views own brand, sees full portal.
- Member-of-A-viewing-B: gets B's data (as member) or not-authorized (as non-member),
  never A's.
- Non-member hitting `/b/<brand>`: sign-in / not-authorized, never a blank portal.
- Sign-out actually clears: after `onSignOut`, reload shows signed-out (no stale chrome).
- Admin sees only own brand: brand-A admin's `/admin` shows A; viewing B's `/admin`
  → not-authorized (no active-org bounce).

**Test-suite migrations (uninventoried regression traps — MUST rewrite)**

- `workers/sprout/__tests__/compliance/tenancy.test.ts` (INV-14): currently a source-grep
  lock that **enshrines the buggy design** — asserts leaf modules derive brandId from
  `context.principal.activeOrgId` (L72–77) and that `/admin` pins to active org via
  `getActiveOrgBrandSlug`/`adminBrandRedirectSlug` (L100–106/115). **Invert:** assert
  leaf handlers resolve via `requireBrandAudience`/`requireBrandAdmin` `context.brand`,
  audience = portal OR org OR platform-admin of the viewed brand, `/admin` gates via
  `requireBrandAdmin`. Extend `LEAF_MODULES` from 4 to all ~15 tenant-scoped modules and
  add a lock that **no** leaf module references `context.principal.activeOrgId` for
  scoping.
- `workers/sprout/__tests__/brand-resolution.test.ts` (L61–81): delete/invert the
  `adminBrandRedirectSlug` block (obsolete once the redirect is removed). Keep the pure
  path-vs-subdomain / `BRAND_COOKIE` resolver tests.

---

## Risks / out-of-scope

**Risks**

- **Partial conversion is worse than none:** switching an outer gate to `context.brand.id`
  while leaving an inner by-id `WHERE` on `activeOrgId` (or vice-versa) yields silent
  empties or a cross-brand fetch that the _current_ test suite would not catch. Mitigation:
  the grep-clean gate per file + the new integration harness.
- **Better-auth org-role scoping assumption (Phase 0):** if `getActiveMemberRole` does not
  honor the passed `organizationId`, `requireBrandAdmin` is unsound — verify first.
- **DO membership check I/O:** the `portal_members`-only fast path in `onConnect` relies on
  the audience gate having already lazily synced org staff. A brand-new org admin who
  opens the socket before ever loading the REST portal would miss; accept an org-role
  fallback hop or require a portal load first.
- **Backfill scope:** the RAG re-embed and analytics reconciliation are non-trivial; if
  deferred, `askAssistant` degrades on the viewed brand until re-embed runs — document the
  window.
- ~~Kit provider reconcile is a shared change across all forks; verify it does not
  introduce refetch storms.~~ **Superseded (D4a):** no kit change — `authClient.useSession()`
  is per-route and scoped to sprout only, so this risk no longer applies.

**Explicitly out of scope**

- `credentials.functions.ts` (per-user CanSell cert — platform-wide by design).
- `sprout-admin.functions.ts` (platform-admin god-mode).
- `award.functions.ts`, hub `listMyPortals`/`listJoinableBrands`/`getFeaturedBrand`/
  `getUnreadCounts`/`approveAccess`, notifications list/mark fns (correct cross-brand /
  user-scoped surfaces).
- `jobs/cron.ts` (row-scoped system writer — do **not** add a viewed-brand gate).
- Multi-tenancy org-plugin wiring / SCIM (tracked separately in CLAUDE.md).
- Push-vs-poll for the notification bell (deferred, unrelated).
