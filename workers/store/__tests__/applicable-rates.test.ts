import { describe, expect, test } from "vitest";
import { applicableShippingRates, type ShippingRateOption } from "@/lib/checkout";

const rate = (id: string, amountCents: number, minSubtotalCents = 0): ShippingRateOption => ({
  id,
  amountCents,
  minSubtotalCents,
});

describe("applicableShippingRates", () => {
  test("filters out rates whose threshold exceeds the subtotal", () => {
    const rates = [rate("cheap", 500), rate("free_over_150", 0, 15_000)];
    expect(applicableShippingRates(rates, 9_000)).toEqual([rate("cheap", 500)]);
    // Once the subtotal clears the threshold, the free rate qualifies (and wins).
    expect(applicableShippingRates(rates, 15_000)).toEqual([
      rate("free_over_150", 0, 15_000),
      rate("cheap", 500),
    ]);
  });

  test("sorts cheapest-first — the default (first) is the least expensive", () => {
    const out = applicableShippingRates([rate("b", 800), rate("a", 300), rate("c", 500)], 9_000);
    expect(out.map((r) => r.id)).toEqual(["a", "c", "b"]);
  });

  test("caps at Stripe's five shipping_options", () => {
    const rates = Array.from({ length: 8 }, (_, i) => rate(`r${i}`, (i + 1) * 100));
    const out = applicableShippingRates(rates, 9_000);
    expect(out).toHaveLength(5);
    expect(out.map((r) => r.amountCents)).toEqual([100, 200, 300, 400, 500]);
  });

  test("empty when no rate qualifies (caller falls back to the flat rate)", () => {
    expect(applicableShippingRates([rate("hi", 500, 100_000)], 9_000)).toEqual([]);
    expect(applicableShippingRates([], 9_000)).toEqual([]);
  });
});
