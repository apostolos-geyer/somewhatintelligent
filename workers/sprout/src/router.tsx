import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { PlatformSession } from "@greenroom/auth";
import type { BrandRuntime } from "@/lib/brand";
import { routeTree } from "@/routeTree.gen";

export interface RouterContext {
  session: PlatformSession | null;
  /** Runtime brand skin resolved from the request host (null on the apex/Hub). */
  brand: BrandRuntime | null;
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    // Leave `defaultPreloadStaleTime` at its 30s default. Pinning it to 0 marked
    // every intent-preload stale the instant it landed, so hovering a <Link>
    // fetched the loader and then threw the result away, re-fetching on click —
    // the worst of both. With the default, a hover warms the loader cache and the
    // click is instant.
    //
    // `defaultStaleTime` (loaders): the router default is 0, which re-fires every
    // matched loader on every navigation — including same-route `?section=`/
    // `?item=` layer flips, which re-fetched banners + roles + hero slides per
    // product click. 30s matches the preload window; anything that mutates calls
    // `router.invalidate()`, which bypasses staleTime entirely.
    defaultStaleTime: 30_000,
    // NO `defaultViewTransition`. It wrapped every soft navigation in a
    // document-wide `startViewTransition` whose exit→enter fade read as the whole
    // UI flashing on each admin sidebar click. Route content swaps in place;
    // overlays (sheets/dialogs) animate themselves.
    context: { session: null, brand: null } satisfies RouterContext,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
