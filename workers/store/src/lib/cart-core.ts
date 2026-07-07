// Pure cart reducers, extracted from the useCart hook (cart.ts) so add / setQty
// / remove / count / subtotal are unit-testable without localStorage + React
// (behavior-identical extraction). The hook wraps these with persistence.

export interface CartLine {
  variantId: string;
  productId: string;
  slug: string;
  title: string;
  size: string;
  priceCents: number;
  coverRef: string | null;
  quantity: number;
}

/** Add `qty` of a line; merges into an existing line for the same variant. */
export function addLine(lines: CartLine[], line: Omit<CartLine, "quantity">, qty = 1): CartLine[] {
  const existing = lines.find((l) => l.variantId === line.variantId);
  if (existing) {
    return lines.map((l) =>
      l.variantId === line.variantId ? { ...l, quantity: l.quantity + qty } : l,
    );
  }
  return [...lines, { ...line, quantity: qty }];
}

/** Set an exact quantity (clamped ≥0); a line at 0 is dropped. */
export function setQtyLines(lines: CartLine[], variantId: string, qty: number): CartLine[] {
  return lines
    .map((l) => (l.variantId === variantId ? { ...l, quantity: Math.max(0, qty) } : l))
    .filter((l) => l.quantity > 0);
}

/** Remove a line entirely. */
export function removeLine(lines: CartLine[], variantId: string): CartLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

/** Total item count across lines. */
export function cartCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** Cart subtotal in cents (display only — the server re-prices at checkout). */
export function cartSubtotalCents(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.priceCents * l.quantity, 0);
}
