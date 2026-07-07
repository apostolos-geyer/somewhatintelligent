import { getRouteApi } from "@tanstack/react-router";

/**
 * Leaf access to the `/_portal` route context (`brand` etc.) for components the
 * shell mounts. Uses `getRouteApi` (route-id lookup, no runtime import of the
 * route file) — importing `Route` from `routes/_portal.tsx` here would close a
 * section → _portal → LayerStack → registry → section cycle.
 */
const portalRoute = getRouteApi("/_portal");

export function usePortalContext() {
  return portalRoute.useRouteContext();
}

/** The portal CONTENT config (tagline / feed label / section toggles) the shell
 * loader fetched in parallel — the page-shape half of the old brand runtime. */
export function usePortalContent() {
  return portalRoute.useLoaderData({ select: (d) => d.content });
}
