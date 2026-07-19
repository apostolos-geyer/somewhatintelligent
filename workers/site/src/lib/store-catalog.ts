/**
 * Server-side StoreCatalog read client (RFC-0001 D4 / "StoreCatalog RPC"). Site
 * binds `STORE` with entrypoint `StoreCatalog`; the generated Env types the
 * binding as a bare `Service`, so the frozen `@si/contracts` interface is
 * asserted here — the one place that cast lives. Read-only: no mutation methods.
 *
 * `Astro.locals.runtime.env` was removed in Astro v6+ / `@astrojs/cloudflare`
 * v14 (its getter throws), so the binding is read from `cloudflare:workers`
 * `env`, lazily at request time.
 */
import { env } from "cloudflare:workers";
import type {
  DomainResult,
  ProductCardDTO,
  ProductDetailDTO,
  StoreCatalogEntrypoint,
} from "@si/contracts";

export type {
  ProductCardDTO,
  ProductDetailDTO,
  ProductVariantDTO,
  PublicMediaRef,
} from "@si/contracts";

/** The STORE service binding, typed to the read-only catalog contract. */
function catalog(): StoreCatalogEntrypoint {
  return env.STORE as unknown as StoreCatalogEntrypoint;
}

/** A keyset page of buyer-visible product cards (newest-updated first). */
export function listProducts(
  input: { limit?: number; cursor?: string } = {},
): Promise<
  DomainResult<{ products: ProductCardDTO[]; nextCursor: string | null }, "invalid_cursor">
> {
  return catalog().listProducts(input);
}

/** The active-release detail DTO for a slug, or a typed `not_found`. */
export function getProductBySlug(
  slug: string,
): Promise<DomainResult<ProductDetailDTO, "not_found">> {
  return catalog().getProductBySlug({ slug });
}

/** Stable public URL for a Store media id — the `/api/store/media/:id` path Store
 *  serves (RFC-0001 D11/D12). Card DTOs carry only `coverMediaId`; detail media
 *  already carry a resolved `href`, so this only builds card cover URLs. */
export function storeMediaHref(mediaId: string): string {
  return `/api/store/media/${mediaId}`;
}

/** Format integer cents as `$68 CAD` (whole) or `$68.50 CAD` (fractional). */
export function formatPrice(priceCents: number, currency: "CAD"): string {
  const dollars = priceCents / 100;
  const body = Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2);
  return `$${body} ${currency}`;
}

/** Human availability label; `null` means exclude from the buyer listing —
 *  `unavailable` never reaches a buyer per the StoreCatalog postcondition, so it
 *  is filtered out defensively. */
export function availabilityLabel(availability: ProductCardDTO["availability"]): string | null {
  switch (availability) {
    case "available":
      return "Available";
    case "sold_out":
      return "Sold out";
    case "unavailable":
      return null;
  }
}
