/**
 * Unit (idiom B) — the viewed-brand resolver (`lib/brand-context.server.ts`).
 *
 * Proves the branching contract from plan doc D1 (section "Unit (gates /
 * policy / resolver)"):
 *   - no-brand (apex) short-circuits before any slug resolution;
 *   - a bogus/unknown slug rejects without touching membership;
 *   - platform-admin is a true short-circuit — no portal or org lookup;
 *   - a portal member (budtender/staff) is a fast accept — no org lookup;
 *   - an org member with no portal row is lazily synced into portal_members
 *     (`source: "org"`) and accepted;
 *   - a caller who is neither a portal nor an org member of the viewed brand
 *     rejects as `not-member`, with no lazy-sync write.
 *
 * `request-host`, `brand.server`, `portal-members`, and `runtime.server` are
 * mocked (headers/D1/guestlist collaborators) so this stays a fast node test
 * with zero real bindings. `policy.server`'s `isPlatformAdmin` is left REAL —
 * it's pure and already covered by `workers/sprout/__tests__/policy.test.ts`.
 *
 * Gate-level behavior (`requireBrandAudience` / `requireBrandAdmin` middleware
 * composition) is intentionally NOT covered here — TanStack Start middleware
 * needs the real request pipeline to exercise meaningfully, which is Phase 8's
 * vitest-pool-workers/e2e job, not this node-test tier.
 */
import { afterEach, describe, expect, test, vi } from "vitest";

const {
  getRequestBrandSlugMock,
  resolveBrandBySlugMock,
  getPortalRoleMock,
  ensurePortalMemberMock,
  listCallerOrgsMock,
} = vi.hoisted(() => ({
  getRequestBrandSlugMock: vi.fn(),
  resolveBrandBySlugMock: vi.fn(),
  getPortalRoleMock: vi.fn(),
  ensurePortalMemberMock: vi.fn(),
  listCallerOrgsMock: vi.fn(),
}));
vi.mock("@/lib/request-host", () => ({ getRequestBrandSlug: getRequestBrandSlugMock }));
vi.mock("@/lib/brand.server", () => ({ resolveBrandBySlug: resolveBrandBySlugMock }));
vi.mock("@/lib/portal-members", () => ({
  getPortalRole: getPortalRoleMock,
  ensurePortalMember: ensurePortalMemberMock,
}));
vi.mock("@/lib/runtime.server", () => ({ listCallerOrgs: listCallerOrgsMock }));
// `@/lib/policy.server` (isPlatformAdmin) is NOT mocked — real, pure, comma-safe.

import { resolveViewedBrandFor } from "@/lib/brand-context.server";

const USER = "u1";
const SLUG = "acme";
const VIEWED = {
  orgId: "org_acme",
  slug: SLUG,
  name: "Acme",
  tagline: "",
  logoRef: null,
  state: "live",
};

afterEach(() => {
  vi.resetAllMocks();
});

describe("resolveViewedBrandFor", () => {
  test("no-brand (apex) → rejects before resolving any slug", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(null);

    expect(await resolveViewedBrandFor(USER, "user")).toEqual({ ok: false, reason: "no-brand" });
    expect(resolveBrandBySlugMock).not.toHaveBeenCalled();
  });

  test("bogus/unknown slug → rejects", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce("nope");
    resolveBrandBySlugMock.mockResolvedValueOnce(null);

    expect(await resolveViewedBrandFor(USER, "user")).toEqual({
      ok: false,
      reason: "unknown-brand",
    });
  });

  test("platform-admin short-circuits: no portal or org lookup, admitted as internal staff", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(SLUG);
    resolveBrandBySlugMock.mockResolvedValueOnce(VIEWED);

    // Audience kind only — a platform admin is internal "staff", not an external
    // budtender; their admin authority is the platform role, resolved at the gate.
    expect(await resolveViewedBrandFor(USER, "admin,user")).toEqual({
      ok: true,
      brand: { id: VIEWED.orgId, slug: SLUG, role: "staff" },
    });
    expect(getPortalRoleMock).not.toHaveBeenCalled();
    expect(listCallerOrgsMock).not.toHaveBeenCalled();
    expect(ensurePortalMemberMock).not.toHaveBeenCalled();
  });

  test("portal member (budtender) is a fast accept — no org lookup", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(SLUG);
    resolveBrandBySlugMock.mockResolvedValueOnce(VIEWED);
    getPortalRoleMock.mockResolvedValueOnce("budtender");

    expect(await resolveViewedBrandFor(USER, "user")).toEqual({
      ok: true,
      brand: { id: VIEWED.orgId, slug: SLUG, role: "budtender" },
    });
    expect(getPortalRoleMock).toHaveBeenCalledWith(VIEWED.orgId, USER);
    expect(listCallerOrgsMock).not.toHaveBeenCalled();
    expect(ensurePortalMemberMock).not.toHaveBeenCalled();
  });

  test("portal member (staff) is a fast accept — no org lookup", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(SLUG);
    resolveBrandBySlugMock.mockResolvedValueOnce(VIEWED);
    getPortalRoleMock.mockResolvedValueOnce("staff");

    expect(await resolveViewedBrandFor(USER, "user")).toEqual({
      ok: true,
      brand: { id: VIEWED.orgId, slug: SLUG, role: "staff" },
    });
    expect(listCallerOrgsMock).not.toHaveBeenCalled();
  });

  test("org-staff lazy sync: no portal row, org membership found → synced into portal_members and admitted as staff", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(SLUG);
    resolveBrandBySlugMock.mockResolvedValueOnce(VIEWED);
    getPortalRoleMock.mockResolvedValueOnce(null);
    // Membership is the RELIABLE cross-org signal (organization.list()), not the
    // active-org-scoped getActiveMemberRole — the viewed brand is in the caller's org list.
    listCallerOrgsMock.mockResolvedValueOnce([
      { id: VIEWED.orgId, slug: SLUG, name: "Acme" },
      { id: "org_other", slug: "other", name: "Other" },
    ]);

    // An org member is folded into the audience as internal "staff" — the audience
    // kind, NOT their org role. Their admin authority is a separate axis resolved at
    // the admin gate (getCallerOrgRole), never encoded in context.brand.role.
    expect(await resolveViewedBrandFor(USER, "user")).toEqual({
      ok: true,
      brand: { id: VIEWED.orgId, slug: SLUG, role: "staff" },
    });
    expect(listCallerOrgsMock).toHaveBeenCalled();
    expect(ensurePortalMemberMock).toHaveBeenCalledWith({
      brandId: VIEWED.orgId,
      userId: USER,
      role: "staff",
      source: "org",
    });
  });

  test("non-member: no portal row and viewed brand not in the caller's org list → rejects, no lazy-sync write", async () => {
    getRequestBrandSlugMock.mockReturnValueOnce(SLUG);
    resolveBrandBySlugMock.mockResolvedValueOnce(VIEWED);
    getPortalRoleMock.mockResolvedValueOnce(null);
    // Caller belongs to some orgs, but NOT the viewed brand's org.
    listCallerOrgsMock.mockResolvedValueOnce([{ id: "org_other", slug: "other", name: "Other" }]);

    expect(await resolveViewedBrandFor(USER, "user")).toEqual({ ok: false, reason: "not-member" });
    expect(ensurePortalMemberMock).not.toHaveBeenCalled();
  });
});
