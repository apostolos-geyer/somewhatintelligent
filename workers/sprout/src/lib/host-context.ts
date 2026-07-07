import { loadSession } from "@/lib/session.functions";
import { getBrandForHost } from "@/lib/brand.functions";
import { getHostSlug } from "@/lib/portal.functions";
import type { PlatformSession } from "@greenroom/auth";
import type { BrandRuntime } from "@/lib/brand";

/**
 * The per-host context the root route needs before first paint: the session, the
 * runtime brand skin, and the raw host/cookie slug (for the unknown-brand 404).
 */
export interface HostContext {
  session: PlatformSession | null;
  brand: BrandRuntime | null;
  hostSlug: string | null;
}

async function fetchHostContext(): Promise<HostContext> {
  const [session, brand, hostSlug] = await Promise.all([
    loadSession(),
    getBrandForHost(),
    getHostSlug(),
  ]);
  return { session, brand, hostSlug };
}

let clientCache: Promise<HostContext> | null = null;

/**
 * Resolve the host context ONCE per client session. The root route's
 * `beforeLoad` re-runs on EVERY navigation (TanStack Router never caches
 * `beforeLoad`), so without this memo every soft navigation — flipping
 * `?item=` on a product card, each admin sidebar click — paid three server-fn
 * round-trips before the router would commit anything. None of these values can
 * change under an SPA session: the brand is keyed to the host (or the
 * `sprout_brand` cookie, which only `/b/$slug` rewrites — it busts this cache),
 * and sign-in/out always round-trips through identity as a full document load,
 * which resets module state anyway. Layout guards that need a LIVE session
 * already re-check via `authClient.useSession()` (see `admin.tsx`, `hub.tsx`).
 *
 * On the server every request resolves fresh — SSR must never leak one
 * request's session/brand into another.
 */
export function resolveHostContext(): Promise<HostContext> {
  if (typeof window === "undefined") return fetchHostContext();
  if (!clientCache) {
    clientCache = fetchHostContext().catch((err: unknown) => {
      // Never memoize a transport failure — the next navigation retries.
      clientCache = null;
      throw err;
    });
  }
  return clientCache;
}

/** Drop the memo so the next navigation re-resolves (e.g. after `/b/$slug`
 * rewrites the path-mode brand cookie on a soft navigation). */
export function invalidateHostContext(): void {
  clientCache = null;
}
