import type { DomainResult } from "./result";
import type { PublicMediaRef } from "./media";

/**
 * `StoreCatalog` — the read-only RPC surface bound only to Site (RFC-0001
 * "StoreCatalog RPC" / D3, D4). It contains no mutation methods. Only products
 * with `status = 'active'` and an active immutable release are returned; draft
 * fields and operator metadata never appear; availability is computed from
 * current variant stock, not release data.
 */
export interface ProductCardDTO {
  id: string;
  slug: string;
  version: string;
  title: string;
  descriptionExcerpt: string | null;
  priceCents: number;
  currency: "CAD";
  coverMediaId: string | null;
  availability: "available" | "sold_out" | "unavailable";
  totalStock: number;
}

export interface ProductVariantDTO {
  id: string;
  size: string;
  sku: string;
  stock: number;
  available: boolean;
}

export interface ProductDetailDTO extends ProductCardDTO {
  descriptionMarkdown: string | null;
  media: PublicMediaRef[];
  variants: ProductVariantDTO[];
}

export interface StoreCatalogEntrypoint {
  listProducts(input: {
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ products: ProductCardDTO[]; nextCursor: string | null }, "invalid_cursor">
  >;

  getProductBySlug(input: { slug: string }): Promise<DomainResult<ProductDetailDTO, "not_found">>;

  getProductById(input: {
    productId: string;
  }): Promise<DomainResult<ProductDetailDTO, "not_found">>;

  openProductMedia(input: { mediaId: string }): Promise<DomainResult<Response, "not_found">>;
}
