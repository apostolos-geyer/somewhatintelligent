/**
 * React view over the browser-only cart (RFC-0001 "Public cart contract"). Reads
 * the SAME localStorage representation the vanilla cart uses via `cart-client`
 * (authoritative `{ variantId, quantity }` lines + a display-only hint cache),
 * combining them into rendering lines for the checkout island. Never a second
 * cart format — the checkout POST still sends the raw `CartV1` from `readCart()`.
 * Browser-only, so it is imported only from `client:only` islands.
 */
import { useCallback, useEffect, useState } from "react";
import { clearCart, readCart, readHints, subscribeCart } from "../../lib/cart-client";

export interface CheckoutLine {
  variantId: string;
  quantity: number;
  title: string;
  size: string;
  priceCents: number;
  currency: "CAD";
}

function buildLines(): CheckoutLine[] {
  const cart = readCart();
  const hints = readHints();
  return cart.lines.map((line) => {
    const hint = hints[line.variantId];
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      title: hint?.title ?? "Item",
      size: hint?.size ?? "",
      priceCents: hint?.priceCents ?? 0,
      currency: hint?.currency ?? "CAD",
    };
  });
}

export function useCart(): {
  lines: CheckoutLine[];
  subtotalCents: number;
  clear: () => void;
} {
  const [lines, setLines] = useState<CheckoutLine[]>(() => buildLines());

  useEffect(() => {
    setLines(buildLines());
    return subscribeCart(() => setLines(buildLines()));
  }, []);

  const subtotalCents = lines.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
  const clear = useCallback(() => clearCart(), []);

  return { lines, subtotalCents, clear };
}
