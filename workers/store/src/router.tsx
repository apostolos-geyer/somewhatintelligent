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
    // THE one place the `/shop` mount enters app code. Client-only: the server
    // router stays at root (bouncer's vmf already stripped the mount), while
    // the browser router re-applies `/shop` so the URL bar keeps the prefix
    // across client-side navigation + hard refresh. Route definitions and every
    // <Link>/navigate/redirect stay prefix-free — TanStack Router prepends the
    // basepath on href generation and strips it on match. See src/lib/basepath.ts.
    basepath: resolveBasepath({
      isServer: typeof window === "undefined",
      publicBase: import.meta.env.PUBLIC_BASE,
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
