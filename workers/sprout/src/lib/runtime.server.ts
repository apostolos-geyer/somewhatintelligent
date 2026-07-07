/**
 * Cloudflare-runtime-bound auth helpers — reach into the guestlist
 * service-binding, so this module is server-only by construction. Kept separate
 * from `policy.server.ts` so that module stays pure.
 */
import { getGuestlist } from "@/lib/guestlist";
import { decideBrandAdmin, type OrgRole } from "@/lib/policy.server";

/**
 * Resolve the caller's BA-org-plugin role in `orgId` via guestlist. Narrows BA's
 * untyped `role` string to `OrgRole | null` (null = not a member / lookup error
 * / unrecognized role — callers treat null as "no authority").
 */
export async function getCallerOrgRole(orgId: string): Promise<OrgRole | null> {
  const res = await getGuestlist().auth.organization.getActiveMemberRole({
    query: { organizationId: orgId },
  });
  if (res.error) return null;
  const role = res.data?.role;
  return role === "owner" || role === "admin" || role === "member" ? role : null;
}

/**
 * Resolve the caller's Brand-Admin authority over `brandId` and throw "forbidden"
 * unless they're owner|admin in the brand's BA org (or platform admin). The
 * in-handler gate the foundation prescribes for every admin mutation — a call,
 * not a middleware, because it needs the already-resolved `brandId`.
 */
export async function assertBrandAdmin(
  brandId: string,
  actorRole: string | readonly string[] | null | undefined,
): Promise<void> {
  const orgRole = await getCallerOrgRole(brandId);
  const decision = decideBrandAdmin({ actorRole, orgRole });
  if (!decision.ok) throw new Error(decision.reason);
}

/**
 * The caller's better-auth org memberships (id/slug/name). `organization.list()`
 * returns EVERY org the caller belongs to, scoped by their own session cookies —
 * the RELIABLE, cross-org membership signal, unlike `getActiveMemberRole` which is
 * scoped to the session's active org. Use this (not `getCallerOrgRole`) wherever the
 * question is "is the caller a member of brand X" for a brand that may not be their
 * active org — portal visibility (the Hub) and the audience gate's org→staff fold.
 * Degrades to `[]` on any error so a guestlist blip never throws the caller.
 */
export async function listCallerOrgs(): Promise<Array<{ id: string; slug: string; name: string }>> {
  try {
    const res = await getGuestlist().auth.organization.list();
    const orgs = (res.data ?? []) as Array<{ id?: string; slug?: string; name?: string }>;
    return orgs
      .filter((o): o is { id: string; slug: string; name: string } =>
        Boolean(o.id && o.slug && o.name),
      )
      .map((o) => ({ id: o.id, slug: o.slug, name: o.name }));
  } catch {
    return [];
  }
}
