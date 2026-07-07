/**
 * The viewed-brand resolver — turns "the request" into an AUTHORIZED viewed
 * brand, unifying slug-resolution + membership so callers stop probing
 * `resolveBrandBySlug(getRequestBrandSlug())` on their own and rolling their own
 * membership check. Server-only (headers + D1 + guestlist); do not import from
 * client components.
 */
import { getRequestBrandSlug } from "@/lib/request-host";
import { resolveBrandBySlug } from "@/lib/brand.server";
import { getPortalRole, ensurePortalMember, type PortalRole } from "@/lib/portal-members";
import { listCallerOrgs } from "@/lib/runtime.server";
import { isPlatformAdmin } from "@/lib/policy.server";

export interface ViewedBrand {
  id: string;
  slug: string;
  /**
   * The caller's AUDIENCE kind for the viewed brand: `"staff"` (internal) or
   * `"budtender"` (external / non-staff) — the `portal_members` standing. This is
   * NOT authority: there is no "brand admin" role. Admin authority is the caller's
   * better-auth ORG role (owner/admin), an orthogonal axis resolved at the gate via
   * `getCallerOrgRole` — never encoded here. Org members and platform admins are
   * folded into the audience as internal `"staff"`.
   */
  role: PortalRole;
}

/**
 * Resolve the viewed brand AND the caller's standing in it, or a rejection
 * reason. `userId` / `actorRole` must come from the verified envelope
 * principal — NEVER from request input — since this resolution IS the
 * tenant-isolation boundary.
 *
 * Active org and viewed brand are orthogonal by design (see plan doc R2): a
 * budtender is the audience of a brand they have NO org membership in at all
 * (so `activeOrgId` is null for them, yet they legitimately view that brand),
 * and an org-admin of Acme can be viewing Beta with Acme still "active." So
 * this resolver never reads `activeOrgId` — it re-derives standing from
 * scratch against the brand the request is actually pointed at.
 */
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

  // Platform-admin short-circuit: god-mode over every brand — admitted without a
  // portal or org lookup. Their audience kind is internal `"staff"` (they're not
  // an external budtender); their admin authority comes from the platform role at
  // the gate, not from this audience standing.
  if (isPlatformAdmin(actorRole)) {
    return { ok: true, brand: { id: viewed.orgId, slug, role: "staff" } };
  }

  // Audience layer: covers budtenders (external `portal_members` rows, no org
  // membership) as well as org staff already lazily synced in below.
  const portal = await getPortalRole(viewed.orgId, userId);
  if (portal) return { ok: true, brand: { id: viewed.orgId, slug, role: portal } };

  // Lazy org→portal sync: an org member of THIS brand is internal audience —
  // fold them in as `"staff"` on first hit, so subsequent reads resolve via the
  // cheap `getPortalRole` above with no guestlist hop. Membership is checked with
  // `listCallerOrgs` (`organization.list()`) — the RELIABLE cross-org signal — NOT
  // `getActiveMemberRole`, which is scoped to the session's ACTIVE org and would
  // wrongly reject an org member viewing a non-active brand. Their ORG role (and
  // thus any admin authority) is a separate axis, resolved at the admin gate via
  // `getCallerOrgRole`; it is deliberately NOT stored in the audience standing
  // (`portal_members.role` can only be budtender|staff). The Hub materializes this
  // same row up front; this is the backstop for direct portal navigation.
  const orgs = await listCallerOrgs();
  if (orgs.some((o) => o.id === viewed.orgId)) {
    await ensurePortalMember({ brandId: viewed.orgId, userId, role: "staff", source: "org" });
    return { ok: true, brand: { id: viewed.orgId, slug, role: "staff" } };
  }

  return { ok: false, reason: "not-member" }; // signed-in, not audience → reject
}
