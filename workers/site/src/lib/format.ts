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

/** Format an epoch-ms timestamp as `18 Jul 2026` (UTC, locale-stable). */
export function formatDate(epochMs: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(epochMs));
}

/** ISO-8601 date string for `article:published_time` OG metadata. */
export function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Stable public URL for a Store media id — the `/api/store/media/:id` path Store
 *  serves (RFC-0001 D11/D12). */
export function storeMediaHref(mediaId: string): string {
  return `/api/store/media/${mediaId}`;
}

/** Stable public URL for a Publisher media id — the `/media/:id` path Site's own
 *  media route forwards to `PublisherPublic.openPublishedMedia` (RFC-0001 D9,
 *  open decision 6: Publisher owns the bare `/media/` prefix, Store owns
 *  `/api/store/media/`). Used for page-document `imageMediaId` values that carry
 *  a bare id rather than a pre-resolved href. */
export function publisherMediaHref(mediaId: string): string {
  return `/media/${mediaId}`;
}
