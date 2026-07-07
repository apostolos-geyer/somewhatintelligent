/**
 * INV-14 — Multi-tenant isolation (docs/sprout/08-compliance-invariants.md §INV-14;
 * tenant-isolation refactor: docs/sprout/11-tenant-isolation-and-session-staleness-fix-plan.md).
 *
 * Brand identity for every tenant-scoped read/write is resolved by the request
 * middleware — `requireBrandAudience` for reads, `requireBrandAdmin` for writes —
 * into `context.brand.id`, the AUTHORIZED viewed brand. It is NEVER taken from
 * `context.principal.activeOrgId` (the session's active org, which is `null` for
 * budtenders and wrong for anyone viewing a brand other than their active org),
 * and NEVER from server-fn input. A forged `brand_id` in `data` cannot reach a
 * query, and a caller who is not audience/admin of the viewed brand is rejected by
 * the gate before any row is touched.
 *
 * This suite INVERTS the pre-refactor lock that enshrined the buggy
 * `activeOrgId`-as-tenant model (each leaf "derived brandId from
 * `context.principal.activeOrgId`"; `/admin` pinned the chrome to the session's
 * active org via `getActiveOrgBrandSlug` / `adminBrandRedirectSlug`). Both models
 * are gone; the locks below fail if either is reintroduced.
 *
 * Idiom B (binding-free). The locks:
 *  1. A unit test of the representative pure authz decision (`decideBrandAdmin`) —
 *     extends the style of `__tests__/policy.test.ts` — proving an unauthorized
 *     actor (no platform-admin role, no owner/admin org-role) is rejected even
 *     though authority is decided purely (no D1/guestlist mocking needed).
 *  2. A source-level guarantee that every tenant-leaf handler scopes by the
 *     authorized `context.brand.id` (resolved through a `requireBrandAudience` /
 *     `requireBrandAdmin` gate) and never from input — plus the security-critical
 *     INVERSE lock: NO leaf module scopes brand by `context.principal.activeOrgId`.
 *  3. `/admin` authorizes against the VIEWED brand via the `requireBrandAdmin`-gated
 *     `getAdminBrandConfig` probe, bouncing a non-admin to that brand's portal
 *     entry — never the old active-org-vs-skin pin dance.
 *
 * The full cross-brand-leakage harness (two seeded brands, the DO socket gate) is
 * the vitest-pool-workers test doc 08 §INV-14 prescribes; it needs real bindings
 * and lives outside this binding-free suite by design.
 */
import { describe, expect, test } from "vitest";
import { decideBrandAdmin, isPlatformAdmin } from "@/lib/policy.server";
import { readSrc, stripComments } from "./_helpers";

describe("INV-14 tenancy — pure authz rejects a forged / unauthorized actor", () => {
  test("a non-admin actor with no qualifying org-role is forbidden (no brand authority)", () => {
    // The forgery the harness models: a caller who is neither platform admin nor
    // owner/admin of the target brand must be denied — authority is never inferred
    // from anything the client supplies.
    expect(decideBrandAdmin({ actorRole: "user", orgRole: null })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "member" })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    // empty / nullish actor roles never escalate
    expect(decideBrandAdmin({ actorRole: "", orgRole: null })).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(decideBrandAdmin({ actorRole: null, orgRole: null })).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  test("authority comes only from a real platform-admin role or an owner/admin org-role", () => {
    // platform admin (comma-separated role string — never compared with === "admin")
    expect(isPlatformAdmin("admin,user")).toBe(true);
    expect(decideBrandAdmin({ actorRole: "admin,user", orgRole: null })).toEqual({ ok: true });
    // genuine brand authority
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "owner" })).toEqual({ ok: true });
    expect(decideBrandAdmin({ actorRole: "user", orgRole: "admin" })).toEqual({ ok: true });
    // a string that merely *contains* "admin" as a substring is not the admin role
    expect(isPlatformAdmin("administrator-wannabe")).toBe(false);
  });
});

describe("INV-14 tenancy — leaf handlers scope by the authorized viewed brand, never the active org / input", () => {
  // Every tenant-scoped domain module converted in Phase 2 of the tenant-isolation
  // refactor: a forged brand_id (or a stale active org) here would leak/corrupt
  // another brand's data. Each resolves its brand through a `requireBrandAudience`
  // (read) / `requireBrandAdmin` (write) gate into `context.brand.id`.
  //
  // EXCLUDED by design (the plan's "audited clean (DO NOT convert)" table + hub's
  // "mostly DO NOT convert" note): hub / portal / notifications / credentials /
  // award / sprout-admin / session — intentionally cross-brand (org∪portal
  // audience, membership-gated join-request + per-brand prefs), per-user, or
  // platform-admin god-mode, so they legitimately do NOT scope by `context.brand.id`.
  const LEAF_MODULES = [
    "src/lib/landing.functions.ts",
    "src/lib/drops.functions.ts",
    "src/lib/banners.functions.ts",
    "src/lib/feed.functions.ts",
    "src/lib/decks.functions.ts",
    "src/lib/quizzes.functions.ts",
    "src/lib/reviews.functions.ts",
    "src/lib/assets.functions.ts",
    "src/lib/brand.functions.ts",
    "src/lib/recordings.functions.ts",
    "src/lib/chat.functions.ts",
    "src/lib/contact.functions.ts",
    "src/lib/requests.functions.ts",
    "src/lib/sessions.functions.ts",
    "src/lib/ai.functions.ts",
    "src/lib/analytics.functions.ts",
  ];

  // Imports at least one brand gate from the shared middleware module — the only
  // place `context.brand` is populated, so scoping by `context.brand.id` is
  // provably backed by an authorization gate rather than a forgeable field.
  const BRAND_GATE_IMPORT =
    /import\s*\{[^}]*requireBrand(?:Audience|Admin)[^}]*\}\s*from\s*["']@\/lib\/middleware\/auth["']/;

  test("each leaf module scopes by the authorized context.brand.id, gated by requireBrandAudience / requireBrandAdmin", () => {
    for (const rel of LEAF_MODULES) {
      const src = stripComments(readSrc(rel));
      expect(src, `${rel} must scope by the authorized viewed brand (context.brand.id)`).toMatch(
        /context\.brand\.id/,
      );
      expect(
        src,
        `${rel} must import a brand gate (requireBrandAudience / requireBrandAdmin) from @/lib/middleware/auth`,
      ).toMatch(BRAND_GATE_IMPORT);
    }
  });

  test("no leaf module scopes brand by context.principal.activeOrgId (the pre-refactor tenancy bug)", () => {
    // The security-critical inverse of the old lock: the `activeOrgId`-as-tenant
    // model must never come back — it is `null` for budtenders and wrong for anyone
    // viewing a brand other than their session's active org.
    const offenders: string[] = [];
    for (const rel of LEAF_MODULES) {
      const src = stripComments(readSrc(rel));
      if (/context\.principal\.activeOrgId/.test(src)) offenders.push(rel);
    }
    expect(
      offenders,
      `activeOrgId-as-tenant scoping reintroduced in:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  test("no leaf handler binds brand_id from client input (the forgery anti-pattern)", () => {
    const offenders: string[] = [];
    // matches `brandId: data.x`, `brand_id: data.x`, `... = data.brandId`
    const FORGERY = /\bbrand(?:Id|_id)\s*:\s*data\.|=\s*data\.brandId\b/;
    for (const rel of LEAF_MODULES) {
      const src = stripComments(readSrc(rel));
      if (FORGERY.test(src)) offenders.push(rel);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("INV-14 tenancy — /admin gates on the VIEWED brand via requireBrandAdmin, not the active org", () => {
  // The brand SKIN follows the host/cookie; Brand-Admin authority must follow the
  // VIEWED brand. The old guard pinned the chrome to the session's active org
  // (getActiveOrgBrandSlug / adminBrandRedirectSlug) — the source of the
  // active-org-vs-skin mismatch. The refactor replaces that dance with a
  // `requireBrandAdmin`-gated probe against the viewed brand; a rejected (signed-in)
  // non-admin bounces to that brand's portal entry (`context.brand.slug`), never an
  // empty admin shell over a brand they can't administer. Source-level lock, binding-free.
  const admin = stripComments(readSrc("src/routes/admin.tsx"));
  const brandFns = stripComments(readSrc("src/lib/brand.functions.ts"));

  test("the /admin guard authorizes against the viewed brand via the requireBrandAdmin-gated probe", () => {
    expect(admin, "/admin must probe the brand-admin gate").toMatch(/probeBrandAdmin\s*\(/);
    expect(
      admin,
      "/admin must bounce a rejected non-admin to the viewed brand's portal entry",
    ).toMatch(/portalEntryUrl\s*\(/);
    expect(
      admin,
      "/admin must derive the bounce target from the VIEWED brand (context.brand.slug), never the active org",
    ).toMatch(/context\.brand\??\.slug/);
  });

  test("the /admin guard no longer pins the chrome to the session's active org", () => {
    // The removed active-org pin dance must not reappear.
    expect(admin, "/admin must not reintroduce active-org pinning").not.toMatch(
      /getActiveOrgBrandSlug|adminBrandRedirectSlug/,
    );
  });

  test("probeBrandAdmin — the /admin authority probe — is requireBrandAdmin-gated", () => {
    // The gate is what makes the probe throw for a non-admin of the viewed brand.
    expect(brandFns).toMatch(/probeBrandAdmin[\s\S]*?\.middleware\(\[\s*requireBrandAdmin\s*\]\)/);
  });
});

describe("INV-14 tenancy — org authority and portal audience are distinct projections of context.brand.role", () => {
  // Org membership (guestlist) confers Brand-Admin authority; portal membership
  // (this app's portal_members) is the budtender audience. Post-refactor BOTH are
  // read as SEPARATE projections of the single authorized `context.brand.role` that
  // `requireBrandAudience` resolves for the VIEWED brand — no per-handler re-probe
  // of `activeOrgId` / `portal_members`. The two must stay distinct: admin authority
  // never comes from a portal-only standing, and portal membership never confers a
  // guestlist org role. Source-level lock, binding-free.
  const portalFns = stripComments(readSrc("src/lib/portal.functions.ts"));
  const authMw = stripComments(readSrc("src/lib/middleware/auth.ts"));
  const hub = stripComments(readSrc("src/lib/hub.functions.ts"));
  const members = stripComments(readSrc("src/lib/portal-members.ts"));

  test("org role and portal (brand) role are distinct server fns", () => {
    expect(portalFns).toMatch(/export const getMyOrgRole\b/);
    expect(portalFns).toMatch(/export const getMyBrandRole\b/);
  });

  test("getMyOrgRole resolves the BA org role from the source of truth (getCallerOrgRole), not context.brand.role", () => {
    // Admin authority (the Admin entry + `/admin` guard) MUST come from the real
    // guestlist org role for the viewed brand. Deriving it from `context.brand.role`
    // masks a Brand-Admin as `"staff"` once they've been lazily synced into
    // `portal_members` (that enum can't encode owner/admin), hiding their own Admin
    // entry on every visit after the first. Gated by requireBrandAudience.
    expect(portalFns).toMatch(
      /getMyOrgRole[\s\S]*?requireBrandAudience[\s\S]*?getCallerOrgRole\s*\(/,
    );
  });

  test("requireBrandAdmin decides authority from getCallerOrgRole, never a context.brand.role projection", () => {
    // The regression that locked Brand-Admins out of their own /admin: mapping the
    // gate-masked `context.brand.role` ("staff" after the portal sync) to an org
    // role yields null → forbidden. Authority must re-resolve via guestlist.
    expect(authMw).toMatch(/requireBrandAdmin[\s\S]*?getCallerOrgRole\s*\(/);
  });

  test("getMyBrandRole projects the SAME authorized standing onto the portal audience, gated by requireBrandAudience", () => {
    expect(portalFns).toMatch(/getMyBrandRole[\s\S]*?requireBrandAudience[\s\S]*?context\.brand\b/);
  });

  test("join approval makes a PORTAL member (budtender), never a guestlist org member", () => {
    expect(hub).toMatch(/ensurePortalMember\s*\(\s*\{[\s\S]*?source:\s*"request"/);
  });

  test("portal_members brand_id is caller-derived, never client input", () => {
    expect(members).not.toMatch(/brand(?:Id|_id)\s*:\s*data\./);
  });
});
