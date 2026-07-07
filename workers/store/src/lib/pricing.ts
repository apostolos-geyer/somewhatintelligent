// Pure order-pricing + stock-validation core, extracted from placeOrder
// (orders.functions.ts) so the money math, the price-from-product rule, and the
// stock/availability guards are unit-testable without the server-fn + D1 batch
// (behavior-identical extraction). placeOrder fetches the rows, calls this, then
// performs the D1 batch (order + line inserts + stock decrements).
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
