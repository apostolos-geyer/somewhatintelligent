import { type } from "arktype";

/**
 * The public browser cart contract (RFC-0001 "Public cart contract" / D11 /
 * INV-CART-1). The cart persists in browser storage and contains ONLY variant
 * IDs and quantities — prices, titles, SKUs, inventory, and totals are never
 * accepted from cart storage as transaction input. Store re-loads authoritative
 * product releases and prices at checkout.
 */
export const CART_STORAGE_KEY = "si:store:cart:v1";
export const CART_MAX_LINES = 50;
export const CART_MIN_QUANTITY = 1;
export const CART_MAX_QUANTITY = 10;

export interface CartLine {
  variantId: string;
  quantity: number;
}

export interface CartV1 {
  version: 1;
  lines: CartLine[];
  updatedAt: number;
}

export const cartLineSchema = type({
  variantId: "string",
  quantity: "1 <= number.integer <= 10",
});

export const cartV1Schema = type({
  version: "1",
  lines: cartLineSchema.array().atMostLength(CART_MAX_LINES),
  updatedAt: "number",
});

/**
 * Recover a well-formed {@link CartV1} from arbitrary storage input:
 *
 * - drop anything malformed (missing/blank variantId, non-integer quantity);
 * - clamp each quantity to 1..10;
 * - coalesce duplicate variant IDs into one line (summed, then re-clamped);
 * - cap at 50 distinct lines.
 *
 * `now` is passed in rather than read from the clock so the function stays pure
 * and testable.
 */
export function normalizeCart(input: unknown, now: number): CartV1 {
  const empty: CartV1 = { version: 1, lines: [], updatedAt: now };
  if (typeof input !== "object" || input === null) return empty;

  const rawLines = (input as { lines?: unknown }).lines;
  if (!Array.isArray(rawLines)) return empty;

  const byVariant = new Map<string, number>();
  for (const entry of rawLines) {
    if (typeof entry !== "object" || entry === null) continue;
    const variantId = (entry as { variantId?: unknown }).variantId;
    const quantity = (entry as { quantity?: unknown }).quantity;
    if (typeof variantId !== "string" || variantId.length === 0) continue;
    if (typeof quantity !== "number" || !Number.isInteger(quantity)) continue;
    const clamped = Math.max(CART_MIN_QUANTITY, Math.min(CART_MAX_QUANTITY, quantity));
    const summed = (byVariant.get(variantId) ?? 0) + clamped;
    byVariant.set(variantId, Math.min(CART_MAX_QUANTITY, summed));
  }

  const lines: CartLine[] = [];
  for (const [variantId, quantity] of byVariant) {
    if (lines.length >= CART_MAX_LINES) break;
    lines.push({ variantId, quantity });
  }
  return { version: 1, lines, updatedAt: now };
}
