import { useNavigate, useSearch } from "@tanstack/react-router";
import { isSectionKey, type SectionKey } from "@/lib/sections";

/**
 * The "sections are layers, not routes" hook. A section opens by flipping the
 * `?section=` (and optional `?item=`) search param on the one-page portal route
 * `/` (`_portal/index`) — TanStack treats this as a same-route search change, so
 * the shell + grid never remount and the grid's scroll offset is physically
 * preserved (03 §"How it maps onto TanStack Router"). Components call
 * `openLayer("decks", id)` / `closeLayer()` without touching router internals.
 *
 * These are DIALOG TOGGLES, not page navigations: opening a layer must not
 * scroll the window to the top, and must never run a page-level view transition
 * even if one is (re)introduced for route navigations (it would stomp the
 * dialog/sheet's own enter animation, making the Sheet "pop" instead of slide).
 * So every navigate here passes `resetScroll: false` + `viewTransition: false` —
 * the URL still updates (deep-link + Back-closes-the-layer stay intact), but
 * visually it's a local open/close the primitive animates itself. See
 * `LAYER_NAV_OPTS`.
 *
 * Read loosely (`strict: false`) so the hook works both in the shell (`_portal.tsx`,
 * which doesn't own the search schema) and in `_portal/index.tsx` (which does).
 */
const LAYER_NAV_OPTS = { resetScroll: false, viewTransition: false } as const;

export function useLayerStack() {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { section?: string; item?: string };

  const section: SectionKey | null = isSectionKey(search.section) ? search.section : null;
  const item: string | null = typeof search.item === "string" ? search.item : null;

  const openLayer = (key: SectionKey, itemId?: string) =>
    navigate({
      to: "/",
      search: (s: Record<string, unknown>) => ({ ...s, section: key, item: itemId }),
      ...LAYER_NAV_OPTS,
    });

  const setItem = (itemId: string | undefined) =>
    navigate({
      to: "/",
      search: (s: Record<string, unknown>) => ({ ...s, item: itemId }),
      ...LAYER_NAV_OPTS,
    });

  const closeLayer = () =>
    navigate({
      to: "/",
      search: (s: Record<string, unknown>) => ({ ...s, section: undefined, item: undefined }),
      ...LAYER_NAV_OPTS,
    });

  return { section, item, openLayer, setItem, closeLayer };
}
