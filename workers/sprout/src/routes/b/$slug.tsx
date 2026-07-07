import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { selectBrand } from "@/lib/brand.functions";
import { invalidateHostContext } from "@/lib/host-context";
import { BRAND_RESOLUTION_MODE, portalEntryUrl } from "@/lib/brand-resolution";

/**
 * Brand ENTRY route — the `path`-mode addressing seam. Visiting `/b/<slug>`
 * selects a brand on the single staging host: `selectBrand` validates the slug
 * and sets the `sprout_brand` cookie, then we redirect to the in-portal `next`
 * (default `/`, the brand landing). The cookie — not the URL — carries the brand
 * from here on, so it survives refresh, navigation, AND server-fn calls (the
 * page path doesn't). Share `/b/acme` to drop a teammate straight into Acme.
 *
 * In `subdomain` mode (dev + prod) brands are addressed by host, so this route is
 * just a convenience hop to the brand's own origin — no cookie involved.
 */
export const Route = createFileRoute("/b/$slug")({
  // Same-origin internal path only — defends ?next= against open redirects.
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const next = search.next;
    return {
      next:
        typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
          ? next
          : undefined,
    };
  },
  beforeLoad: async ({ params, search }) => {
    const next = search.next ?? "/";
    if (BRAND_RESOLUTION_MODE === "subdomain") {
      throw redirect({ href: portalEntryUrl(import.meta.env.SPROUT_URL, params.slug, next) });
    }
    const res = await selectBrand({ data: { slug: params.slug } });
    if (!res.ok) throw notFound();
    // The cookie just changed which brand this host resolves to — drop the
    // client-side host-context memo so the redirect below re-resolves the new
    // skin instead of reusing the previous brand's (relevant when this route is
    // reached by soft navigation; a document load resets the memo anyway).
    invalidateHostContext();
    throw redirect({ href: next });
  },
});
