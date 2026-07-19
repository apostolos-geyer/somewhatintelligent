import type { DomainResult } from "./result";
import type { OperatorCall } from "./operator";
import type { ConfirmDeletionInput, DeletionError, DeletionPlan } from "./deletion";
import type { ProductMediaDTO } from "./media";
import type { ProductVariantDTO } from "./store-catalog";

/**
 * `StoreOperator` — the operator-mutation RPC surface bound only to Operator
 * (RFC-0001 "StoreOperator RPC" / D3, D8, D13). Each success produces exactly
 * one domain mutation and one `store_operator_event`; repeating an idempotency
 * key returns the prior result without repeating the mutation. Product or
 * product-release deletion never deletes an order, order-item snapshot, Stripe
 * ledger record, or fulfillment fact.
 */
export type ProductStatus = "draft" | "active" | "unavailable" | "archived";

export interface ProductDraftDTO {
  productId: string;
  slug: string;
  revision: number;
  title: string;
  descriptionMarkdown: string | null;
  priceCents: number;
  status: ProductStatus;
  activeVersion: string | null;
  updatedAt: number;
}

/** Buyer shipping address (RFC-0001 "Store public HTTP API"). Canada-only. */
export interface ShippingAddress {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal: string;
  country: "CA";
  phone?: string;
}

export type OrderStatus = "pending" | "paid" | "shipped" | "delivered" | "cancelled";

export interface OrderListInput {
  status?: OrderStatus | "all";
  limit?: number;
  cursor?: string;
}

export interface OrderListResult {
  orders: Array<{
    orderNumber: string;
    email: string;
    shipName: string | null;
    totalCents: number;
    status: OrderStatus;
    paymentStatus: string;
    createdAt: number;
  }>;
  nextCursor: string | null;
}

export interface OrderDetailDTO {
  orderNumber: string;
  customerId: string;
  email: string;
  status: OrderStatus;
  paymentStatus: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  shipping: ShippingAddress | null;
  carrier: string | null;
  trackingNumber: string | null;
  fulfillmentNote: string | null;
  shippedAt: number | null;
  deliveredAt: number | null;
  items: Array<{
    productId: string;
    variantId: string;
    title: string;
    size: string;
    unitPriceCents: number;
    quantity: number;
  }>;
}

export interface SetOrderStatusInput {
  orderNumber: string;
  status: "paid" | "cancelled";
}

export interface FulfillOrderInput {
  orderNumber: string;
  carrier: string;
  trackingNumber: string;
  note?: string;
}

export type OrderMutationError =
  | "not_found"
  | "invalid_transition"
  | "payment_incomplete"
  | "already_fulfilled";

export interface StoreOperatorEntrypoint {
  listProducts(
    call: OperatorCall<{ status?: ProductStatus | "all"; limit?: number; cursor?: string }>,
  ): Promise<
    DomainResult<{ products: ProductDraftDTO[]; nextCursor: string | null }, "invalid_cursor">
  >;

  getProduct(call: OperatorCall<{ productId: string }>): Promise<
    DomainResult<
      {
        draft: ProductDraftDTO;
        releases: Array<{ id: string; version: string; publishedAt: number }>;
        variants: ProductVariantDTO[];
        media: ProductMediaDTO[];
      },
      "not_found"
    >
  >;

  createProduct(
    call: OperatorCall<{
      slug: string;
      title: string;
      descriptionMarkdown?: string | null;
      priceCents: number;
    }>,
  ): Promise<DomainResult<{ productId: string; revision: 1 }, "slug_taken" | "invalid_price">>;

  saveProductDraft(
    call: OperatorCall<{
      productId: string;
      expectedRevision: number;
      title?: string;
      descriptionMarkdown?: string | null;
      priceCents?: number;
      slug?: string;
    }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "slug_taken" | "invalid_price"
    >
  >;

  publishProduct(
    call: OperatorCall<{ productId: string; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      | "not_found"
      | "revision_conflict"
      | "invalid_version"
      | "version_exists"
      | "missing_media"
      | "missing_variant"
    >
  >;

  setProductStatus(
    call: OperatorCall<{ productId: string; status: ProductStatus }>,
  ): Promise<DomainResult<{ status: ProductStatus }, "not_found" | "no_release">>;

  planProductReleaseDeletion(
    call: OperatorCall<{
      productId: string;
      releaseId: string;
      replacementReleaseId?: string | null;
    }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">>;
  deleteProductRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>>;

  planProductDeletion(
    call: OperatorCall<{ productId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteProduct(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  putVariant(
    call: OperatorCall<{
      productId: string;
      variantId?: string;
      size: string;
      sku: string;
      stock: number;
    }>,
  ): Promise<
    DomainResult<{ variantId: string }, "not_found" | "sku_taken" | "size_taken" | "invalid_stock">
  >;

  adjustStock(
    call: OperatorCall<{ variantId: string; delta: number; reason: string }>,
  ): Promise<DomainResult<{ stock: number }, "not_found" | "negative_stock">>;

  planVariantDeletion(
    call: OperatorCall<{ productId: string; variantId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteVariant(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  reorderProductMedia(
    call: OperatorCall<{ productId: string; mediaIds: string[] }>,
  ): Promise<DomainResult<{ ok: true }, "not_found" | "invalid_order">>;
  planProductMediaDeletion(
    call: OperatorCall<{ productId: string; mediaId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteProductMedia(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; productStatus: ProductStatus }, DeletionError>>;

  listOrders(
    call: OperatorCall<OrderListInput>,
  ): Promise<DomainResult<OrderListResult, "invalid_cursor">>;
  getOrder(
    call: OperatorCall<{ orderNumber: string }>,
  ): Promise<DomainResult<OrderDetailDTO, "not_found">>;
  setOrderStatus(
    call: OperatorCall<SetOrderStatusInput>,
  ): Promise<DomainResult<OrderDetailDTO, OrderMutationError>>;
  fulfillOrder(
    call: OperatorCall<FulfillOrderInput>,
  ): Promise<DomainResult<OrderDetailDTO, OrderMutationError>>;
  markDelivered(
    call: OperatorCall<{ orderNumber: string }>,
  ): Promise<DomainResult<OrderDetailDTO, OrderMutationError>>;
}
