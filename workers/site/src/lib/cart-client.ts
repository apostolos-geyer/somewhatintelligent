/**
 * Browser-only cart state (RFC-0001 "Public cart contract" / INV-CART-1). The
 * authoritative cart persists in localStorage under `CART_STORAGE_KEY` and holds
 * ONLY `{ variantId, quantity }` — never prices, titles, SKUs, or inventory.
 * Store re-loads authoritative releases and re-prices at checkout, so nothing
 * from cart storage is ever a transaction input.
 *
 * A SEPARATE, display-only hint cache (`si:store:cart:hints:v1`) maps each
 * variant id to a rendering snapshot so /cart can show a line without a round
 * trip and works offline; hints are never sent to checkout. All mutations run
 * the shared `normalizeCart` (dedupe by variantId, clamp qty 1..10, cap 50
 * lines) so the on-disk cart stays within contract even after direct edits.
 *
 * Every writer dispatches a `si:cart:changed` window event; `subscribeCart` also
 * listens to cross-tab `storage` events. This module touches `window`/
 * `localStorage`, so it must only ever be imported from client `<script>`
 * islands, never Astro frontmatter.
 */
import {
  CART_MAX_LINES,
  CART_MAX_QUANTITY,
  CART_MIN_QUANTITY,
  CART_STORAGE_KEY,
  normalizeCart,
  type CartV1,
} from "@si/contracts/cart";

const HINTS_STORAGE_KEY = "si:store:cart:hints:v1";
const CART_CHANGED_EVENT = "si:cart:changed";

/** Display-only snapshot captured at add-to-cart time; never a checkout input. */
export interface CartLineHint {
  productId: string;
  slug: string;
  title: string;
  size: string;
  priceCents: number;
  currency: "CAD";
  coverMediaId: string | null;
}

export type CartHints = Record<string, CartLineHint>;

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function clampQuantity(quantity: number): number {
  const n = Math.trunc(Number(quantity));
  if (!Number.isFinite(n)) return CART_MIN_QUANTITY;
  return Math.max(CART_MIN_QUANTITY, Math.min(CART_MAX_QUANTITY, n));
}

/** The normalized cart from storage (empty when storage is unavailable). */
export function readCart(): CartV1 {
  if (!hasStorage()) return { version: 1, lines: [], updatedAt: Date.now() };
  let raw: unknown = null;
  try {
    const text = window.localStorage.getItem(CART_STORAGE_KEY);
    raw = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    raw = null;
  }
  return normalizeCart(raw, Date.now());
}

function persist(cart: CartV1): CartV1 {
  const normalized = normalizeCart(cart, Date.now());
  if (hasStorage()) {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // quota exceeded or storage disabled — keep the in-memory value.
    }
    window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
  }
  return normalized;
}

/** Add `quantity` of a variant (dedupe-summed, clamped). Optionally records a
 *  display hint. A full cart (50 distinct lines) ignores a brand-new variant. */
export function addLine(variantId: string, quantity = 1, hint?: CartLineHint): CartV1 {
  if (!variantId) return readCart();
  const cart = readCart();
  const qty = clampQuantity(quantity);
  const existing = cart.lines.find((l) => l.variantId === variantId);
  if (existing) {
    existing.quantity = clampQuantity(existing.quantity + qty);
  } else if (cart.lines.length < CART_MAX_LINES) {
    cart.lines.push({ variantId, quantity: qty });
  } else {
    return cart;
  }
  if (hint) writeHint(variantId, hint);
  return persist(cart);
}

/** Set a variant's absolute quantity (clamped 1..10); no-op if absent. */
export function setQuantity(variantId: string, quantity: number): CartV1 {
  const cart = readCart();
  const line = cart.lines.find((l) => l.variantId === variantId);
  if (!line) return cart;
  line.quantity = clampQuantity(quantity);
  return persist(cart);
}

/** Remove a variant line and its display hint. */
export function removeLine(variantId: string): CartV1 {
  const cart = readCart();
  cart.lines = cart.lines.filter((l) => l.variantId !== variantId);
  removeHint(variantId);
  return persist(cart);
}

/** Empty the cart and its hints. */
export function clearCart(): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.removeItem(CART_STORAGE_KEY);
    window.localStorage.removeItem(HINTS_STORAGE_KEY);
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent(CART_CHANGED_EVENT));
}

/** Total unit count across lines — the header badge value. */
export function cartCount(): number {
  return readCart().lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** All display hints keyed by variant id. */
export function readHints(): CartHints {
  if (!hasStorage()) return {};
  try {
    const text = window.localStorage.getItem(HINTS_STORAGE_KEY);
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as CartHints) : {};
  } catch {
    return {};
  }
}

/** Record/replace a variant's display hint (display-only, never a checkout input). */
export function writeHint(variantId: string, hint: CartLineHint): void {
  if (!hasStorage()) return;
  const hints = readHints();
  hints[variantId] = hint;
  try {
    window.localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(hints));
  } catch {
    // ignore
  }
}

function removeHint(variantId: string): void {
  if (!hasStorage()) return;
  const hints = readHints();
  if (variantId in hints) {
    delete hints[variantId];
    try {
      window.localStorage.setItem(HINTS_STORAGE_KEY, JSON.stringify(hints));
    } catch {
      // ignore
    }
  }
}

/** Subscribe to in-tab writes (`si:cart:changed`) and cross-tab `storage`
 *  events; returns an unsubscribe. */
export function subscribeCart(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onChange = (): void => callback();
  const onStorage = (e: StorageEvent): void => {
    if (e.key === CART_STORAGE_KEY || e.key === HINTS_STORAGE_KEY) callback();
  };
  window.addEventListener(CART_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CART_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export { CART_MAX_QUANTITY, CART_MIN_QUANTITY, CART_MAX_LINES };
