/**
 * `StoreOperator` — the operator-mutation RPC entrypoint bound to Operator only
 * (RFC-0001 "StoreOperator RPC" / D3, D8, D13). The class name IS the binding
 * contract: Operator binds `service si-store-<env>` with
 * `entrypoint: "StoreOperator"`, so the name must match exactly. It is
 * re-exported from the worker entry (`worker.ts`) so wrangler resolves the named
 * entrypoint.
 *
 * Every method delegates to a pure `lib/operator` core against `this.env.DB`,
 * keeping the whole D1 write path pool-testable without the WorkerEntrypoint
 * runtime. Each core honors `meta.idempotencyKey` via `store_operator_event` and
 * writes exactly one mutation + one event per success (INV-AUDIT-1).
 *
 * `implements StoreOperatorEntrypoint` locks the surface to the @si/contracts
 * SSOT. Two-step hard-delete (plan/confirm) delegates to the same `lib/operator`
 * cores; media GC drains on the scheduled handler (`lib/media-gc`).
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { err, ok } from "@si/contracts";
import type {
  DomainResult,
  MediaMutationError,
  ProductMediaDTO,
  StoreOperatorEntrypoint,
} from "@si/contracts";

import { ulid } from "@somewhatintelligent/kit/ids";
import * as schema from "@/db/schema";
import { mediaHref } from "@/lib/catalog";
import type { Db } from "@/lib/db";
import * as ops from "@/lib/operator";

type P<M extends keyof StoreOperatorEntrypoint> = Parameters<StoreOperatorEntrypoint[M]>[0];
type R<M extends keyof StoreOperatorEntrypoint> = ReturnType<StoreOperatorEntrypoint[M]>;

// Domain media validation ceiling above the private port (RFC-0001 D10). The
// 100 MB bound is Roadie's single-part limit (media-storage-roadie.ts); the
// accepted image types are the browser-encodable set the storefront serves.
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);
const MEDIA_ROLES = new Set(["cover", "gallery", "evidence"]);

export class StoreOperator extends WorkerEntrypoint<Env> implements StoreOperatorEntrypoint {
  private db(): Db {
    return drizzle(this.env.DB, { schema });
  }

  listProducts(call: P<"listProducts">): R<"listProducts"> {
    return ops.listProducts(this.db(), call);
  }
  getProduct(call: P<"getProduct">): R<"getProduct"> {
    return ops.getProduct(this.db(), call);
  }
  createProduct(call: P<"createProduct">): R<"createProduct"> {
    return ops.createProduct(this.db(), call);
  }
  saveProductDraft(call: P<"saveProductDraft">): R<"saveProductDraft"> {
    return ops.saveProductDraft(this.db(), call);
  }
  publishProduct(call: P<"publishProduct">): R<"publishProduct"> {
    return ops.publishProduct(this.db(), call);
  }
  setProductStatus(call: P<"setProductStatus">): R<"setProductStatus"> {
    return ops.setProductStatus(this.db(), call);
  }
  putVariant(call: P<"putVariant">): R<"putVariant"> {
    return ops.putVariant(this.db(), call);
  }
  adjustStock(call: P<"adjustStock">): R<"adjustStock"> {
    return ops.adjustStock(this.db(), call);
  }
  reorderProductMedia(call: P<"reorderProductMedia">): R<"reorderProductMedia"> {
    return ops.reorderProductMedia(this.db(), call);
  }
  listOrders(call: P<"listOrders">): R<"listOrders"> {
    return ops.listOrders(this.db(), call);
  }
  getOrder(call: P<"getOrder">): R<"getOrder"> {
    return ops.getOrder(this.db(), call);
  }
  setOrderStatus(call: P<"setOrderStatus">): R<"setOrderStatus"> {
    return ops.setOrderStatus(this.db(), call);
  }
  fulfillOrder(call: P<"fulfillOrder">): R<"fulfillOrder"> {
    return ops.fulfillOrder(this.db(), call);
  }
  markDelivered(call: P<"markDelivered">): R<"markDelivered"> {
    return ops.markDelivered(this.db(), call);
  }

  // ── Operator-only media ingest (RFC-0001 D10 / T19) ─────────────────────────
  // NOT part of the frozen StoreOperatorEntrypoint contract: the storage
  // lifecycle is not an RPC method on the documented surface (INV-MEDIA-1). This
  // private path is reached only over the same Operator→Store service binding,
  // undocumented in @si/contracts. Operator streams the file here; Store
  // validates it, writes the bytes through the private MediaStorage port, and
  // returns the completed domain media DTO — no register/finalize/signed-URL
  // vocabulary crosses the boundary. Cloudflare Workers RPC carries the
  // byte-oriented `body` ReadableStream across the binding without buffering
  // (docs: "Streams over RPC").
  async ingestProductMedia(input: {
    productId: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    size: number;
    sha256: string;
    alt: string;
    role: "cover" | "gallery" | "evidence";
  }): Promise<DomainResult<ProductMediaDTO, MediaMutationError>> {
    if (!MEDIA_ROLES.has(input.role)) return err("invalid_role");
    if (!ALLOWED_MEDIA_TYPES.has(input.contentType)) return err("unsupported_type");
    if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_MEDIA_BYTES) {
      return err("invalid_size");
    }

    const db = this.db();
    const [product] = await db
      .select({ id: schema.productBase.id })
      .from(schema.productBase)
      .where(eq(schema.productBase.id, input.productId))
      .limit(1);
    if (!product) return err("not_found");

    // Resolve the private port lazily (keeps the Roadie SDK out of non-request
    // module graphs), mirroring StoreCatalog.mediaStorage().
    const [{ createRoadieMediaStorage, STORE_MEDIA_APPLICATION }, { getRoadie }] =
      await Promise.all([import("@/lib/media-storage-roadie"), import("@/lib/roadie")]);
    const media = createRoadieMediaStorage(
      getRoadie() as unknown as Parameters<typeof createRoadieMediaStorage>[0],
      { application: STORE_MEDIA_APPLICATION },
    );

    // Mint the domain media id and hand it to the port as `key`; the port
    // returns the private storage_key we persist (T5 convention).
    const mediaId = ulid();
    const put = await media.put({
      key: mediaId,
      body: input.body,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
    });
    if (!put.ok) return err("storage_unavailable");

    const [last] = await db
      .select({ position: schema.productImage.position })
      .from(schema.productImage)
      .where(eq(schema.productImage.productId, input.productId))
      .orderBy(desc(schema.productImage.position))
      .limit(1);
    const position = last ? last.position + 1 : 0;
    const now = new Date();
    await db.insert(schema.productImage).values({
      id: mediaId,
      productId: input.productId,
      storageKey: put.value.key,
      contentSha256: input.sha256,
      contentType: input.contentType,
      sizeBytes: input.size,
      width: null,
      height: null,
      alt: input.alt,
      role: input.role,
      position,
      state: "ready",
      createdAt: now,
      readyAt: now,
    });

    return ok({
      id: mediaId,
      productId: input.productId,
      alt: input.alt,
      role: input.role,
      position,
      state: "ready",
      href: mediaHref(mediaId),
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
      width: null,
      height: null,
    });
  }

  // ── Hard-delete plan/confirm + media GC (RFC-0001 D8/D10, INV-DEL-1..4) ──────
  planProductReleaseDeletion(
    call: P<"planProductReleaseDeletion">,
  ): R<"planProductReleaseDeletion"> {
    return ops.planProductReleaseDeletion(this.db(), call);
  }
  deleteProductRelease(call: P<"deleteProductRelease">): R<"deleteProductRelease"> {
    return ops.deleteProductRelease(this.db(), call);
  }
  planProductDeletion(call: P<"planProductDeletion">): R<"planProductDeletion"> {
    return ops.planProductDeletion(this.db(), call);
  }
  deleteProduct(call: P<"deleteProduct">): R<"deleteProduct"> {
    return ops.deleteProduct(this.db(), call);
  }
  planVariantDeletion(call: P<"planVariantDeletion">): R<"planVariantDeletion"> {
    return ops.planVariantDeletion(this.db(), call);
  }
  deleteVariant(call: P<"deleteVariant">): R<"deleteVariant"> {
    return ops.deleteVariant(this.db(), call);
  }
  planProductMediaDeletion(call: P<"planProductMediaDeletion">): R<"planProductMediaDeletion"> {
    return ops.planProductMediaDeletion(this.db(), call);
  }
  deleteProductMedia(call: P<"deleteProductMedia">): R<"deleteProductMedia"> {
    return ops.deleteProductMedia(this.db(), call);
  }
}
