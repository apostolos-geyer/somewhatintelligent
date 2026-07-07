/**
 * PURE authz predicates for sprout. No `cloudflare:workers`, no env — trivially
 * unit-testable. Binding-touching
 * helpers (the guestlist org-role hop) live in `runtime.server.ts`.
 */
import { isAdminRole } from "@greenroom/kit/roles";

/** BA-org-plugin role values returned by `getActiveMemberRole`. */
export type OrgRole = "owner" | "admin" | "member";

/**
 * Platform-operator role lives on `envelope.actor.role` (guestlist-level, a
 * COMMA-SEPARATED string — never compare with `=== "admin"`). Platform admin is
 * god-mode: anywhere sprout gates on brand authority, platform admin passes
 * regardless of BA org membership.
 */
export function isPlatformAdmin(actorRole: string | readonly string[] | null | undefined): boolean {
  return isAdminRole(actorRole);
}

export type BrandAdminDecision = { ok: true } | { ok: false; reason: "forbidden" };

/**
 * Brand-Admin authority requires owner|admin in the brand's BA org (members are
 * read-only). Platform admin always passes. Single decision point so the rule is
 * unit-testable without mocking D1 + guestlist + envelope.
 */
export function decideBrandAdmin(opts: {
  actorRole: string | readonly string[] | null | undefined;
  orgRole: OrgRole | null;
}): BrandAdminDecision {
  if (isPlatformAdmin(opts.actorRole)) return { ok: true };
  return opts.orgRole === "owner" || opts.orgRole === "admin"
    ? { ok: true }
    : { ok: false, reason: "forbidden" };
}
