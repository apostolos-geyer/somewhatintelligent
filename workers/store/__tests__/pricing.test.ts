import { describe, expect, test } from "vitest";
import {
  calculateShipping,
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
} from "@/lib/config";
import { computeOrderTotals, type PricingProduct, type PricingVariant } from "@/lib/pricing";

describe("calculateShipping", () => {
  test("empty / non-positive subtotal → free", () => {
    expect(calculateShipping(0)).toBe(0);
    expect(calculateShipping(-500)).toBe(0);
  });

  test("below the free threshold → flat rate", () => {
    expect(calculateShipping(100)).toBe(FLAT_SHIPPING_CENTS);
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD_CENTS - 1)).toBe(FLAT_SHIPPING_CENTS);
  });

  test("at/above the free threshold → free", () => {
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD_CENTS)).toBe(0);
    expect(calculateShipping(FREE_SHIPPING_THRESHOLD_CENTS + 10_000)).toBe(0);
  });
});

const product = (over: Partial<PricingProduct> = {}): PricingProduct => ({
  id: "p1",
  title: "Field Tee",
  priceCents: 3000,
  status: "active",
  ...over,
});
const variant = (over: Partial<PricingVariant> = {}): PricingVariant => ({
  id: "v1",
  productId: "p1",
  size: "M",
  stock: 10,
  ...over,
});

describe("computeOrderTotals", () => {
  test("prices from the product row, sums subtotal, adds shipping", () => {
    const res = computeOrderTotals(
      [{ variantId: "v1", quantity: 2 }],
      [variant()],
      [product({ priceCents: 3000 })],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subtotalCents).toBe(6000);
    expect(res.shippingCents).toBe(FLAT_SHIPPING_CENTS); // 6000 < 7500 threshold
    expect(res.totalCents).toBe(6000 + FLAT_SHIPPING_CENTS);
    expect(res.lines).toEqual([
      {
        variantId: "v1",
        productId: "p1",
        title: "Field Tee",
        size: "M",
        unitPriceCents: 3000,
        quantity: 2,
      },
    ]);
  });

  test("free shipping once the subtotal clears the threshold", () => {
    const res = computeOrderTotals(
      [{ variantId: "v1", quantity: 3 }],
      [variant()],
      [product({ priceCents: 3000 })],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subtotalCents).toBe(9000);
    expect(res.shippingCents).toBe(0);
    expect(res.totalCents).toBe(9000);
  });

  test("sums multiple lines", () => {
    const res = computeOrderTotals(
      [
        { variantId: "v1", quantity: 1 },
        { variantId: "v2", quantity: 2 },
      ],
      [variant({ id: "v1" }), variant({ id: "v2", productId: "p2", size: "L" })],
      [product({ id: "p1", priceCents: 2000 }), product({ id: "p2", priceCents: 1000 })],
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.subtotalCents).toBe(2000 + 2 * 1000);
  });

  test("empty cart is rejected", () => {
    expect(computeOrderTotals([], [], [])).toEqual({ ok: false, error: "empty_cart" });
  });

  test("unknown variant is rejected", () => {
    const res = computeOrderTotals([{ variantId: "ghost", quantity: 1 }], [variant()], [product()]);
    expect(res).toMatchObject({ ok: false, error: "variant_not_found", message: "ghost" });
  });

  test("non-active product is unavailable", () => {
    const res = computeOrderTotals(
      [{ variantId: "v1", quantity: 1 }],
      [variant()],
      [product({ status: "draft" })],
    );
    expect(res).toMatchObject({ ok: false, error: "product_unavailable" });
  });

  test("quantity exceeding stock is out_of_stock (and never prices)", () => {
    const res = computeOrderTotals(
      [{ variantId: "v1", quantity: 11 }],
      [variant({ stock: 10 })],
      [product()],
    );
    expect(res).toMatchObject({ ok: false, error: "out_of_stock" });
  });

  test("exactly-in-stock quantity is allowed", () => {
    const res = computeOrderTotals(
      [{ variantId: "v1", quantity: 10 }],
      [variant({ stock: 10 })],
      [product({ priceCents: 100 })],
    );
    expect(res.ok).toBe(true);
  });
});
