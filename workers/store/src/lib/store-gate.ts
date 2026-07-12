// Pre-launch gate. One predicate shared by the route guards (index, cart,
// product detail, _app), the header nav, and the public product server fns —
// so "who can see the shop" can never drift between UI and data layer.
// Admin roles bypass the gate so the catalog can be staged before launch.
import { isAdminRole } from "@somewhatintelligent/kit/roles";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { STORE_LIVE } from "@/lib/config";

export function storeOpenFor(session: PlatformSession | null | undefined): boolean {
  return STORE_LIVE || isAdminRole(session?.user.role);
}
