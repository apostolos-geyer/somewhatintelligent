// Order-pricing + stock-validation core, extracted from placeOrder
// (orders.functions.ts) so the money math, the price-from-release rule, and the
// stock/availability guards are unit-testable without the server-fn + D1 batch.
// `computeOrderTotals` stays a pure function over already-loaded rows;
// `loadPricingInputs` is the one D1 read that sources those rows — live variant
// stock/size plus each product's title + price from its ACTIVE release. The
// checkout and place-order paths call the loader, then the pure compute.
import { eq, inArray } from "drizzle-orm";
import { productBase, productRelease, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";
import { calculateShipping } from "@/lib/config";

export interface OrderItemInput {
  variantId: string;
  quantity: number;
}
export interface PricingVariant {
  id: string;
  productId: string;
  size: string;
  stock: number;
}
export interface PricingProduct {
  id: string;
  title: string;
  priceCents: number;
  status: string;
}
export interface OrderLine {
  variantId: string;
  productId: string;
  title: string;
  size: string;
  unitPriceCents: number;
  quantity: number;
}
export type OrderTotals =
  | {
      ok: true;
      lines: OrderLine[];
      subtotalCents: number;
      shippingCents: number;
      totalCents: number;
    }
  | { ok: false; error: string; message?: string };

/**
 * Validate a cart against the authoritative product/variant rows and compute
 * totals. The unit price is ALWAYS taken from the product row — never the
 * client — so a stale/forged cart snapshot can't set the price. Fails closed on
 * a missing variant, an unavailable (non-active) product, or insufficient stock.
 */
export function computeOrderTotals(
  items: OrderItemInput[],
  variants: PricingVariant[],
  products: PricingProduct[],
): OrderTotals {
  if (variants.length === 0) return { ok: false, error: "empty_cart" };

  const productById = new Map(products.map((p) => [p.id, p]));
  const variantById = new Map(variants.map((v) => [v.id, v]));

  let subtotalCents = 0;
  const lines: OrderLine[] = [];

  for (const item of items) {
    const v = variantById.get(item.variantId);
    if (!v) return { ok: false, error: "variant_not_found", message: item.variantId };
    const p = productById.get(v.productId);
    if (!p || p.status !== "active") {
      return { ok: false, error: "product_unavailable", message: v.productId };
    }
    if (v.stock < item.quantity) {
      return { ok: false, error: "out_of_stock", message: `${p.title} (${v.size})` };
    }
    subtotalCents += p.priceCents * item.quantity;
    lines.push({
      variantId: v.id,
      productId: p.id,
      title: p.title,
      size: v.size,
      unitPriceCents: p.priceCents,
      quantity: item.quantity,
    });
  }

  const shippingCents = calculateShipping(subtotalCents);
  return {
    ok: true,
    lines,
    subtotalCents,
    shippingCents,
    totalCents: subtotalCents + shippingCents,
  };
}

/**
 * Load the authoritative pricing inputs for a set of cart variant ids: live
 * size + stock from product_variant, and each product's title + price from its
 * ACTIVE release (product.active_release_id → product_release). The draft copy
 * and price are never read — only the immutable active release drives checkout
 * money (INV-CHK-1). A product with no active release contributes no
 * PricingProduct row, so computeOrderTotals fails it closed as
 * product_unavailable. The result feeds straight into computeOrderTotals.
 */
export async function loadPricingInputs(
  db: Db,
  variantIds: readonly string[],
): Promise<{ variants: PricingVariant[]; products: PricingProduct[] }> {
  if (variantIds.length === 0) return { variants: [], products: [] };
  const variants = await db
    .select({
      id: productVariant.id,
      productId: productVariant.productId,
      size: productVariant.size,
      stock: productVariant.stock,
    })
    .from(productVariant)
    .where(inArray(productVariant.id, [...variantIds]));

  const productIds = [...new Set(variants.map((v) => v.productId))];
  const products = productIds.length
    ? await db
        .select({
          id: productBase.id,
          title: productRelease.title,
          priceCents: productRelease.priceCents,
          status: productBase.status,
        })
        .from(productBase)
        .innerJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
        .where(inArray(productBase.id, productIds))
    : [];

  return { variants, products };
}
