import { describe, expect, test } from "vitest";
import {
  addLine,
  cartCount,
  cartSubtotalCents,
  removeLine,
  setQtyLines,
  type CartLine,
} from "@/lib/cart-core";

const line = (over: Partial<CartLine> = {}): Omit<CartLine, "quantity"> => ({
  variantId: "v1",
  productId: "p1",
  slug: "field-tee",
  title: "Field Tee",
  size: "M",
  priceCents: 3000,
  coverRef: null,
  ...over,
});

describe("addLine", () => {
  test("adds a new line with the given quantity", () => {
    const next = addLine([], line(), 2);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ variantId: "v1", quantity: 2 });
  });

  test("merges quantity into an existing line for the same variant", () => {
    const next = addLine([{ ...line(), quantity: 1 }], line(), 3);
    expect(next).toHaveLength(1);
    expect(next[0]!.quantity).toBe(4);
  });

  test("keeps distinct variants separate", () => {
    const next = addLine([{ ...line(), quantity: 1 }], line({ variantId: "v2", size: "L" }), 1);
    expect(next).toHaveLength(2);
  });

  test("does not mutate the input array", () => {
    const start: CartLine[] = [{ ...line(), quantity: 1 }];
    addLine(start, line(), 1);
    expect(start[0]!.quantity).toBe(1);
  });
});

describe("setQtyLines", () => {
  test("sets an exact quantity", () => {
    const next = setQtyLines([{ ...line(), quantity: 1 }], "v1", 5);
    expect(next[0]!.quantity).toBe(5);
  });

  test("dropping to 0 (or below) removes the line", () => {
    expect(setQtyLines([{ ...line(), quantity: 2 }], "v1", 0)).toHaveLength(0);
    expect(setQtyLines([{ ...line(), quantity: 2 }], "v1", -3)).toHaveLength(0);
  });
});

describe("removeLine", () => {
  test("removes the matching variant only", () => {
    const lines: CartLine[] = [
      { ...line({ variantId: "v1" }), quantity: 1 },
      { ...line({ variantId: "v2" }), quantity: 1 },
    ];
    expect(removeLine(lines, "v1").map((l) => l.variantId)).toEqual(["v2"]);
  });
});

describe("cartCount / cartSubtotalCents", () => {
  const lines: CartLine[] = [
    { ...line({ variantId: "v1", priceCents: 3000 }), quantity: 2 },
    { ...line({ variantId: "v2", priceCents: 1500 }), quantity: 1 },
  ];
  test("count sums quantities", () => {
    expect(cartCount(lines)).toBe(3);
  });
  test("subtotal sums price × quantity", () => {
    expect(cartSubtotalCents(lines)).toBe(2 * 3000 + 1500);
  });
  test("empty cart totals are zero", () => {
    expect(cartCount([])).toBe(0);
    expect(cartSubtotalCents([])).toBe(0);
  });
});
