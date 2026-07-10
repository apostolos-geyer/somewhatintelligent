import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { routeTree } from "@/routeTree.gen";
import { mountRewrite, readMountMeta, resolveBasepath } from "@/lib/basepath";

export interface RouterContext {
  session: PlatformSession | null;
}

export function getRouter() {
  // THE one place the `/shop` mount enters app code. Client-only: the server
  // router stays at root (bouncer's vmf already stripped the mount), while
  // the browser router re-applies `/shop` so the URL bar keeps the prefix
  // across client-side navigation + hard refresh. Route definitions and every
  // <Link>/navigate/redirect stay prefix-free. The mount rides the `rewrite`
  // option, NOT `basepath` — TanStack Start clobbers `basepath` on both sides
  // (see mountRewrite in src/lib/basepath.ts for the full story).
  const mount = resolveBasepath({
    isServer: typeof window === "undefined",
    publicBase: import.meta.env.PUBLIC_BASE,
    mountMeta: readMountMeta(),
  });

  const router = createTanStackRouter({
    routeTree,
    rewrite: mountRewrite(mount),
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
