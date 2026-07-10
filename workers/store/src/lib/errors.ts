// Typed errors + session/role assertions. The server functions translate
// these into result objects or let them bubble to TanStack's error boundary.
import type { PlatformSession } from "@somewhatintelligent/auth";
import { isAdminRole } from "@somewhatintelligent/kit/roles";

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor() {
    super("forbidden");
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "not_found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export function requireSession(
  session: PlatformSession | null,
): asserts session is PlatformSession {
  if (!session) throw new UnauthorizedError();
}

export function isAdmin(session: PlatformSession | null): boolean {
  // Platform role model: guestlist's `user.role` (seeded `super@user.com` is
  // admin). `isAdminRole` handles the comma-separated string/array shape.
  return isAdminRole(session?.user.role);
}

// Admin gate for server functions. Catalog + order management is admin-only.
export function requireAdmin(session: PlatformSession | null): asserts session is PlatformSession {
  requireSession(session);
  if (!isAdminRole(session.user.role)) throw new ForbiddenError();
}
