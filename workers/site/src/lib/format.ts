/**
 * Pure display helpers safe to import from browser islands — no worker bindings
 * (`cloudflare:workers`) here, so this module bundles cleanly into client
 * scripts. `store-catalog.ts` re-exports these for server pages.
 */

/** Format integer cents as `$68 CAD` (whole) or `$68.50 CAD` (fractional). */
export function formatPrice(priceCents: number, currency: "CAD"): string {
  const dollars = priceCents / 100;
  const body = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${body} ${currency}`;
}

/** Stable public URL for a Store media id — the `/api/store/media/:id` path Store
 *  serves (RFC-0001 D11/D12). */
export function storeMediaHref(mediaId: string): string {
  return `/api/store/media/${mediaId}`;
}
