/**
 * Shared presentational pieces for the checkout island: the order-summary line
 * list, the totals rows, and the store-error -> human-copy map. Styling is the
 * site's `.tx-*` shell classes plus checkout-local `.checkout-*` classes the
 * page `<style>` owns; no `@si/ui`, no Tailwind.
 */
import { formatPrice } from "../../lib/format";
import type { CheckoutLine } from "./use-cart";

export const ERROR_MESSAGES: Record<string, string> = {
  empty_cart: "Your cart is empty.",
  invalid_cart: "Your cart could not be read. Please review it and try again.",
  product_unavailable: "An item in your cart is no longer available.",
  variant_unavailable: "A selected size is no longer available.",
  out_of_stock: "An item in your cart is out of stock.",
  stripe_customer_failed: "We could not start a payment session. Please try again.",
  stripe_session_failed: "We could not start a payment session. Please try again.",
  unauthorized: "Please sign in to complete checkout.",
  network: "We could not reach the store. Please check your connection and try again.",
};

export function errorMessage(error: string): string {
  return ERROR_MESSAGES[error] ?? "Checkout failed. Please try again.";
}

export function OrderLines({ lines }: { lines: CheckoutLine[] }) {
  return (
    <ul className="checkout-lines">
      {lines.map((line) => (
        <li key={line.variantId} className="checkout-line">
          <span className="checkout-line-name">
            {line.title}
            {line.size ? ` · ${line.size}` : ""} ×{line.quantity}
          </span>
          <span className="checkout-line-price">
            {formatPrice(line.priceCents * line.quantity, line.currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Pre-formatted rows so one component serves the pre-payment and
 *  session-driven summaries. `total` is omitted while it is not yet known. */
export function OrderTotals({
  subtotal,
  shipping,
  total,
}: {
  subtotal: string;
  shipping: string;
  total?: string;
}) {
  return (
    <dl className="checkout-totals">
      <div className="checkout-total-row">
        <dt>Subtotal</dt>
        <dd>{subtotal}</dd>
      </div>
      <div className="checkout-total-row">
        <dt>Shipping</dt>
        <dd>{shipping}</dd>
      </div>
      {total !== undefined && (
        <div className="checkout-total-row checkout-total-row--grand">
          <dt>Total</dt>
          <dd>{total}</dd>
        </div>
      )}
    </dl>
  );
}
