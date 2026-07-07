// Client-side cart, persisted to localStorage. The cart holds display
// snapshots for rendering; the server re-validates every variant + price at
// checkout (placeOrder), so a stale client snapshot can never set the price.
// The pure reducers live in cart-core.ts (unit-tested); this hook wraps them
// with localStorage persistence + cross-tab sync.
import { useCallback, useEffect, useState } from "react";
import {
  addLine,
  cartCount,
  cartSubtotalCents,
  removeLine,
  setQtyLines,
  type CartLine,
} from "@/lib/cart-core";

export type { CartLine } from "@/lib/cart-core";

const KEY = "si.store.cart.v1";
const EVT = "si-store-cart-change";

function read(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CartLine[]) : [];
  } catch {
    return [];
  }
}

function write(lines: CartLine[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVT));
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);

  useEffect(() => {
    setLines(read());
    const sync = () => setLines(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const add = useCallback((line: Omit<CartLine, "quantity">, qty = 1) => {
    write(addLine(read(), line, qty));
  }, []);

  const setQty = useCallback((variantId: string, qty: number) => {
    write(setQtyLines(read(), variantId, qty));
  }, []);

  const remove = useCallback((variantId: string) => {
    write(removeLine(read(), variantId));
  }, []);

  const clear = useCallback(() => write([]), []);

  const count = cartCount(lines);
  const subtotalCents = cartSubtotalCents(lines);

  return { lines, add, setQty, remove, clear, count, subtotalCents };
}
