/**
 * Auth middlewares for sprout server functions. `envelopeMiddleware` (from kit,
 * via lib/platform) verifies the platform envelope once per request — gates
 * compose on top of it by reference so TSS dedupes the verify even when several
 * gates stack. Uses the comma-safe `isAdminRole` (never `role === "admin"`).
 *
 * `requireBrandAudience` / `requireBrandAdmin` are the viewed-brand tenant-
 * isolation gates (plan doc D2): they stack on `requireUserMiddleware` and add
 * the async D1/guestlist viewed-brand resolution (`resolveViewedBrandFor`) that
 * a synchronous `createPrincipalGate` predicate can't do.
 */
import { redirect, notFound } from "@tanstack/react-router";
import { createMiddleware } from "@tanstack/react-start";
import { createPrincipalGate, type Principal } from "@greenroom/kit/react-start";
import { isAdminRole } from "@greenroom/kit/roles";
import { envelopeMiddleware } from "@/lib/platform";
import { resolveViewedBrandFor } from "@/lib/brand-context.server";
import { decideBrandAdmin, isPlatformAdmin } from "@/lib/policy.server";
import { getCallerOrgRole } from "@/lib/runtime.server";

export { envelopeMiddleware };

type UserPrincipal = Extract<Principal, { kind: "user" }>;

/** Any signed-in user. Reject → identity sign-in. */
export const requireUserMiddleware = createPrincipalGate({
  envelope: envelopeMiddleware,
  predicate: (p): p is UserPrincipal => p.kind === "user",
  onReject: () => {
    throw redirect({ href: "/sign-in" });
  },
});

/** Platform admin (god-mode) — gates /sprout-admin. `user.role` is comma-sep. */
export const requireAdminMiddleware = createPrincipalGate({
  envelope: envelopeMiddleware,
  predicate: (p): p is UserPrincipal => p.kind === "user" && isAdminRole(p.actor.role),
  onReject: () => {
    throw redirect({ href: "/" });
  },
});

/**
 * READS: signed-in AND (portal-member OR org-member OR platform-admin) of the
 * VIEWED brand (the host label in subdomain mode / `sprout_brand` cookie in
 * path mode — see `getRequestBrandSlug`) — NEVER `principal.activeOrgId`,
 * which is a different axis (the caller's own active better-auth org) and is
 * `null` for budtenders by design (see plan doc R2). Exposes `context.brand`
 * once, already resolved AND authorized, so every brand-scoped handler reads
 * `context.brand.id` instead of re-deriving it. `createPrincipalGate` only
 * narrows synchronously, so this gate stacks on top of `requireUserMiddleware`
 * (itself a principal gate) and does the async D1/guestlist hop in `.server()`.
 * Stacking by reference means TSS runs the envelope verify + user check
 * exactly once even when `requireBrandAdmin` → this → `requireUserMiddleware`
 * all appear on the same handler.
 */
export const requireBrandAudience = createMiddleware({ type: "request" })
  .middleware([requireUserMiddleware]) // guarantees principal.kind === "user"
  .server(async ({ next, context }) => {
    const { actor } = context.principal; // narrowed by requireUserMiddleware
    const res = await resolveViewedBrandFor(actor.id, actor.role);
    if (!res.ok) throw notFound(); // cloak: no data, no silently-empty 200
    return next({ context: { brand: res.brand } });
  });

/**
 * WRITES: audience of the viewed brand AND `decideBrandAdmin` against the
 * caller's org role for that SAME viewed brand (never the session's active
 * org). Reuses `requireBrandAudience`'s resolution rather than re-resolving,
 * so `context.brand` is computed exactly once per request no matter how many
 * gates a handler's middleware chain lists.
 */
export const requireBrandAdmin = createMiddleware({ type: "request" })
  .middleware([requireBrandAudience]) // reuses the resolution above
  .server(async ({ next, context }) => {
    const { actor } = context.principal;
    // Authority is the caller's ORG role for the VIEWED brand, resolved from the
    // source of truth (guestlist) via `getCallerOrgRole` — NOT `context.brand.role`,
    // which is only the AUDIENCE kind (staff|budtender) and carries no authority.
    // Trusting the audience standing masked a real Brand-Admin as non-admin
    // (`portal_members.role` can't encode owner/admin), locking them out of their
    // own `/admin`. Platform admin passes via `decideBrandAdmin`'s `actorRole`
    // check, so skip the org hop for them.
    const orgRole = isPlatformAdmin(actor.role) ? null : await getCallerOrgRole(context.brand.id);
    const decision = decideBrandAdmin({ actorRole: actor.role, orgRole });
    if (!decision.ok) throw notFound(); // member but not admin → cloak the admin surface
    return next({ context: { brand: context.brand } }); // authority ∈ owner|admin|platform-admin
  });
