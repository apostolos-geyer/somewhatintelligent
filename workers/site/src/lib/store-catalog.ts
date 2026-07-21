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

// Pure display helpers live in ./format so browser islands can import them
// without pulling in the `cloudflare:workers` binding; re-exported here for the
// server pages that already import them from this module.
export { formatPrice, storeMediaHref } from "./format";

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

/** The active-release detail DTO for a product id, or a typed `not_found`. Used
 *  by the /cart display lookup — the browser cart holds only variant ids, so the
 *  cart island resolves each unique product's current title/price/media here. */
export function getProductById(
  productId: string,
): Promise<DomainResult<ProductDetailDTO, "not_found">> {
  return catalog().getProductById({ productId });
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
