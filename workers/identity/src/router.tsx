import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { PlatformSession } from "@si/auth";
import { routeTree } from "@/routeTree.gen";
import { readMountMeta, resolveBasepath } from "@/lib/basepath";

export interface RouterContext {
  session: PlatformSession | null;
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    // THE one place the `/account` mount enters app code. Client-only: the
    // server router stays at root (bouncer's vmf strips the mount); the
    // browser router adopts the mount bouncer announces via the si-mount
    // meta so the URL bar keeps `/account` across client-side navigation.
    basepath: resolveBasepath({
      isServer: typeof window === "undefined",
      publicBase: null,
      mountMeta: readMountMeta(),
    }),
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
    context: { session: null } satisfies RouterContext,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
