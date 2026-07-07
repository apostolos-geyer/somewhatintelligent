import { createFileRoute, redirect } from "@tanstack/react-router";
import { isSectionKey, type SectionKey } from "@/lib/sections";

interface HomeSearch {
  section?: SectionKey;
  item?: string;
}

/**
 * `/home` is now a COMPAT REDIRECT. The portal collapsed into a single
 * vertical-scroll page on `/` (`_portal/index`) — the section grid and Drop Sheet
 * moved up there beneath the hero, and "Enter Portal" scrolls to them instead of
 * navigating here. Any lingering `/home` link (an old bookmark, a stale deep
 * link) bounces to `/`, carrying its `?section=` / `?item=` so the layer it
 * targeted still opens.
 */
export const Route = createFileRoute("/_portal/home")({
  validateSearch: (search: Record<string, unknown>): HomeSearch => ({
    section: isSectionKey(search.section) ? search.section : undefined,
    item: typeof search.item === "string" ? search.item : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/", search, replace: true });
  },
});
