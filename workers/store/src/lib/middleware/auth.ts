// Auth middleware for the store's server functions. This platform resolves the
// session through the bouncer Ed25519 envelope + guestlist RPC (`getSession`,
// composed in lib/platform.ts). We expose SESSION-shaped function middleware
// (not principal gates) so the ported server fns keep reading
// `context.session.user.{id,email,role}` unchanged.
//
// Admin gating uses `isAdminRole` (@si/kit/roles) — `user.role` is a
// comma-separated string/array, never compared with `=== "admin"`. Every
// mutating admin server fn attaches `requireAdminMiddleware`, mirrored by a
// route-level `beforeLoad` gate (src/routes/_app/admin.tsx) — enforced in BOTH
// places, as the source did.
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { isAdminRole } from "@si/kit/roles";
import type { PlatformSession } from "@si/auth";
import { getSession } from "@/lib/platform";
import { ForbiddenError, UnauthorizedError } from "@/lib/errors";

// Soft auth: resolve the session (may be null) onto context.session.
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const session = await getSession(getRequestHeaders());
  return next({ context: { session } });
});

// Require any authenticated user; narrows context.session to non-null.
export const requireAuthMiddleware = createMiddleware({ type: "function" })
  .middleware([authMiddleware])
  .server(async ({ context, next }) => {
    const session = context.session as PlatformSession | null;
    if (!session) throw new UnauthorizedError();
    return next({ context: { session } });
  });

// Require platform admin.
export const requireAdminMiddleware = createMiddleware({ type: "function" })
  .middleware([authMiddleware])
  .server(async ({ context, next }) => {
    const session = context.session as PlatformSession | null;
    if (!session) throw new UnauthorizedError();
    if (!isAdminRole(session.user.role)) throw new ForbiddenError();
    return next({ context: { session } });
  });
