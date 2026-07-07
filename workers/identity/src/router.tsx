import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { PlatformSession } from "@si/auth";
import { routeTree } from "@/routeTree.gen";

export interface RouterContext {
  session: PlatformSession | null;
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
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
