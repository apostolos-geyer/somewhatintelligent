/**
 * Portal (brand-scoped) server fns for the one-page shell. Two SEPARATE axes, both
 * gated by `requireBrandAudience` (which resolves the VIEWED brand + admits the
 * caller) — no per-handler re-probe of `resolveBrandBySlug`/`activeOrgId`:
 *  - `getMyOrgRole`   — the caller's better-auth ORG role for the viewed brand,
 *    from the guestlist source of truth (`getCallerOrgRole`); confers Brand-Admin
 *    authority (the Admin entry + `/admin` guard). There is no "brand admin" role
 *    — authority is purely the org role.
 *  - `getMyBrandRole` — the caller's AUDIENCE kind (`staff` internal / `budtender`
 *    external), i.e. the authorized `context.brand.role`; org staff and platform
 *    admins are folded into the audience as `staff`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireBrandAudience } from "@/lib/middleware/auth";
import { getRequestBrandSlug } from "@/lib/request-host";
import { type PortalRole } from "@/lib/portal-members";
import { getCallerOrgRole } from "@/lib/runtime.server";
import type { OrgRole } from "@/lib/policy.server";

/**
 * Gated GET: the caller's ORG role for the brand they're VIEWING, or null —
 * drives the Admin entry ("are you an admin of THIS portal"). Resolves the role
 * from the source of truth (guestlist) via `getCallerOrgRole`, NOT from
 * `context.brand.role`: once org staff are lazily synced into `portal_members`,
 * the resolver reports `context.brand.role` as `"staff"` (an audience standing
 * that can't encode owner/admin), which would hide the Admin entry from a real
 * Brand-Admin on every visit after their first. `getCallerOrgRole` passes
 * `organizationId` explicitly, so it's correct for the viewed brand even when it
 * isn't the caller's session-active org, and returns null for a
 * platform-admin/budtender/pure-staff (no BA org role for this brand).
 */
export const getMyOrgRole = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<OrgRole | null> => {
    return getCallerOrgRole(context.brand.id);
  });

/**
 * Gated GET: the caller's AUDIENCE kind (`staff` / `budtender`) for the viewed
 * brand — the authorized `context.brand.role` the gate already resolved (org staff
 * and platform admins fold in as `staff`; the lazy org→portal sync lives in
 * `resolveViewedBrandFor`, so we never write here).
 */
export const getMyBrandRole = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<PortalRole> => {
    return context.brand.role;
  });

/**
 * Public GET: the brand slug selected for this request under the active
 * addressing strategy (host label in subdomain mode, `sprout_brand` cookie in
 * path mode), or null for the Hub apex / unselected brand. The root route uses
 * this to tell a bogus brand (slug present but no registered brand) apart from
 * the legitimate apex, so the former renders a not-found page instead of
 * silently falling back to the Hub.
 */
export const getHostSlug = createServerFn({ method: "GET" }).handler(
  async (): Promise<string | null> => getRequestBrandSlug(),
);
