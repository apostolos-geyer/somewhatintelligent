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
 * SSOT. Plan/confirm hard-delete lands in T13 — those methods are stubbed
 * not-implemented here.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import type { StoreOperatorEntrypoint } from "@si/contracts";

import * as schema from "@/db/schema";
import type { Db } from "@/lib/db";
import * as ops from "@/lib/operator";

type P<M extends keyof StoreOperatorEntrypoint> = Parameters<StoreOperatorEntrypoint[M]>[0];
type R<M extends keyof StoreOperatorEntrypoint> = ReturnType<StoreOperatorEntrypoint[M]>;

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

  // ── Hard-delete plan/confirm — lands in T13 (Store hard-delete + media GC) ──
  async planProductReleaseDeletion(
    _call: P<"planProductReleaseDeletion">,
  ): R<"planProductReleaseDeletion"> {
    throw new Error("not_implemented");
  }
  async deleteProductRelease(_call: P<"deleteProductRelease">): R<"deleteProductRelease"> {
    throw new Error("not_implemented");
  }
  async planProductDeletion(_call: P<"planProductDeletion">): R<"planProductDeletion"> {
    throw new Error("not_implemented");
  }
  async deleteProduct(_call: P<"deleteProduct">): R<"deleteProduct"> {
    throw new Error("not_implemented");
  }
  async planVariantDeletion(_call: P<"planVariantDeletion">): R<"planVariantDeletion"> {
    throw new Error("not_implemented");
  }
  async deleteVariant(_call: P<"deleteVariant">): R<"deleteVariant"> {
    throw new Error("not_implemented");
  }
  async planProductMediaDeletion(
    _call: P<"planProductMediaDeletion">,
  ): R<"planProductMediaDeletion"> {
    throw new Error("not_implemented");
  }
  async deleteProductMedia(_call: P<"deleteProductMedia">): R<"deleteProductMedia"> {
    throw new Error("not_implemented");
  }
}
