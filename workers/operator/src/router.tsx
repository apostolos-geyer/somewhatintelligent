import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import type { OperatorActor } from "@si/contracts";
import { routeTree } from "@/routeTree.gen";

// The resolved Access actor for this request. Seeded by the root route's
// `beforeLoad` (via the `whoAmI` server fn) from the request context set in
// worker.ts, so route components render actor identity without re-verifying.
export interface RouterContext {
  actor: OperatorActor | null;
}

// Operator is root-mounted on its own desk.* hostname (RFC-0001 D6) — NOT
// vmf-mounted behind bouncer — so this router has NO mountRewrite/basepath.
// Route paths live at the app root with no prefix.
export function getRouter() {
  return createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    defaultViewTransition: true,
    context: { actor: null } satisfies RouterContext,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
