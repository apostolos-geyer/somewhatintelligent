/**
 * `StoreCatalog` — the read-only RPC entrypoint bound to Site only (RFC-0001
 * "StoreCatalog RPC" / D3, D4). The class name IS the binding contract: Site
 * binds `service si-store-<env>` with `entrypoint: "StoreCatalog"`, so the name
 * must match exactly. It is re-exported from the worker entry (`worker.ts`) so
 * wrangler resolves the named entrypoint; it contains no mutation methods.
 *
 * Every method delegates to a pure `lib/catalog` function against `this.env.DB`.
 * The private `MediaStorage` port is resolved lazily (so the Roadie SDK never
 * enters non-request module graphs) through the overridable `mediaStorage()`
 * seam — the pool suite subclasses this to inject a stub read port.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import type { DomainResult, ProductCardDTO, ProductDetailDTO } from "@si/contracts";

import * as schema from "@/db/schema";
import type { Db } from "@/lib/db";
import type { MediaStorage } from "@/lib/media-storage";
import {
  getActiveProductDetailById,
  getActiveProductDetailBySlug,
  listActiveProductCards,
  openProductMedia,
} from "@/lib/catalog";

export class StoreCatalog extends WorkerEntrypoint<Env> {
  private db(): Db {
    return drizzle(this.env.DB, { schema });
  }

  /** The store's private media read port. Overridden in tests to inject a stub;
   *  in production it wraps Roadie behind the frozen MediaStorage adapter. */
  protected async mediaStorage(): Promise<MediaStorage> {
    const [{ createRoadieMediaStorage, STORE_MEDIA_APPLICATION }, { getRoadie }] =
      await Promise.all([import("@/lib/media-storage-roadie"), import("@/lib/roadie")]);
    return createRoadieMediaStorage(
      getRoadie() as unknown as Parameters<typeof createRoadieMediaStorage>[0],
      { application: STORE_MEDIA_APPLICATION },
    );
  }

  async listProducts(input: {
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ products: ProductCardDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    return listActiveProductCards(this.db(), input);
  }

  async getProductBySlug(input: {
    slug: string;
  }): Promise<DomainResult<ProductDetailDTO, "not_found">> {
    return getActiveProductDetailBySlug(this.db(), input.slug);
  }

  async getProductById(input: {
    productId: string;
  }): Promise<DomainResult<ProductDetailDTO, "not_found">> {
    return getActiveProductDetailById(this.db(), input.productId);
  }

  async openProductMedia(input: { mediaId: string }): Promise<DomainResult<Response, "not_found">> {
    return openProductMedia(this.db(), await this.mediaStorage(), input.mediaId);
  }
}
