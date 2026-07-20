/**
 * Stripe branch of the checkout island (embedded Payment Element, Checkout
 * Sessions "elements" ui_mode). Two phases: a pre-payment review that reserves
 * stock via `createCheckoutSession` (store-api-client) and yields the client
 * secret, then the payment step inside `<CheckoutProvider>` where Stripe owns
 * the shipping address, shipping rate, and card entry. Stripe collects the
 * address in the payment step, so totals are session-driven and `confirm()`
 * redirects the browser to the session's return_url on success.
 */
import { useState } from "react";
import { loadStripe, type Stripe, type StripeCheckoutShippingOption } from "@stripe/stripe-js";
import {
  CheckoutProvider,
  PaymentElement,
  ShippingAddressElement,
  useCheckout,
} from "@stripe/react-stripe-js/checkout";
import { formatPrice } from "../../lib/format";
import { readCart } from "../../lib/cart-client";
import { createCheckoutSession } from "../../lib/store-api-client";
import { OrderLines, OrderTotals, errorMessage } from "./parts";
import type { CheckoutLine } from "./use-cart";

// Stripe.js loads only from js.stripe.com via the npm loader — never bundled
// (PCI SAQ-A). Lazily initialized in-browser with the publishable key from the
// public store config, so the site needs no build-time Stripe key.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function StripeCheckout({
  lines,
  subtotalCents,
  publishableKey,
}: {
  lines: CheckoutLine[];
  subtotalCents: number;
  publishableKey: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  if (clientSecret) {
    return (
      <CheckoutProvider stripe={getStripe(publishableKey)} options={{ clientSecret }}>
        <PaymentPhase lines={lines} fallbackSubtotalCents={subtotalCents} />
      </CheckoutProvider>
    );
  }

  return <PrePaymentPhase lines={lines} subtotalCents={subtotalCents} onReady={setClientSecret} />;
}

// Pre-payment review: order summary + "Continue to payment". No address form —
// Stripe collects the shipping address and rate in the payment step, so the
// shipping row reads "Calculated at payment" here.
function PrePaymentPhase({
  lines,
  subtotalCents,
  onReady,
}: {
  lines: CheckoutLine[];
  subtotalCents: number;
  onReady: (clientSecret: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (submitting || lines.length === 0) return;
    setSubmitting(true);
    setError(null);
    const result = await createCheckoutSession(readCart());
    if (result.ok === false) {
      setError(errorMessage(result.error));
      setSubmitting(false);
      return;
    }
    if (result.mode !== "stripe") {
      // stripeEnabled and a stub result share the same gate, so this is
      // unreachable in practice — surface it rather than silently stalling.
      setError("Checkout is unavailable right now.");
      setSubmitting(false);
      return;
    }
    onReady(result.clientSecret);
  };

  return (
    <div>
      <OrderLines lines={lines} />
      <OrderTotals subtotal={formatPrice(subtotalCents, "CAD")} shipping="Calculated at payment" />
      <button
        type="button"
        className="tx-button tx-button--block"
        disabled={submitting}
        onClick={() => void start()}
      >
        {submitting ? "Preparing checkout…" : "Continue to payment"}
      </button>
      <p className="checkout-fine-print">
        Shipping address and card details are entered securely on the next step.
      </p>
      {error && (
        <p className="tx-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Payment step (inside <CheckoutProvider>): Stripe's ShippingAddressElement +
// shipping-method picker + PaymentElement. Totals are session-driven so rate
// switches update live; confirm() auto-attaches the collected address and
// redirects to the session return_url on success.
function PaymentPhase({
  lines,
  fallbackSubtotalCents,
}: {
  lines: CheckoutLine[];
  fallbackSubtotalCents: number;
}) {
  const checkout = useCheckout();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const session = checkout.type === "success" ? checkout.checkout : null;
  const subtotalCents = session?.total.subtotal.minorUnitsAmount ?? fallbackSubtotalCents;
  const shippingCents = session?.total.shippingRate.minorUnitsAmount ?? null;
  const totalCents = session?.total.total.minorUnitsAmount ?? fallbackSubtotalCents;
  const shippingOptions = session?.shippingOptions ?? [];
  const selectedShippingId = session?.shipping?.shippingOption.id ?? null;

  const pay = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    const res = await session.confirm();
    if (res.type === "error") {
      // On success Stripe redirects to return_url; only errors return here.
      setSubmitting(false);
      setError(res.error.message ?? "Payment could not be completed.");
    }
  };

  return (
    <div>
      <h2 className="checkout-subhead">Shipping</h2>
      {checkout.type === "error" ? (
        <p className="tx-error" role="alert">
          {checkout.error.message}
        </p>
      ) : (
        <div className="stripe-field">
          <ShippingAddressElement />
          {shippingOptions.length > 1 && (
            <ShippingOptionPicker
              options={shippingOptions}
              selectedId={selectedShippingId}
              onSelect={(id) => void session?.updateShippingOption(id)}
            />
          )}
        </div>
      )}

      <h2 className="checkout-subhead">Card details</h2>
      {checkout.type === "error" ? (
        <p className="tx-error" role="alert">
          {checkout.error.message}
        </p>
      ) : (
        <div className="stripe-field">
          <PaymentElement />
        </div>
      )}
      {checkout.type === "loading" && <p className="tx-status">Loading payment form…</p>}

      <h2 className="checkout-subhead">Order summary</h2>
      <OrderLines lines={lines} />
      <OrderTotals
        subtotal={formatPrice(subtotalCents, "CAD")}
        shipping={
          shippingCents === null
            ? "Calculated at payment"
            : shippingCents === 0
              ? "Free"
              : formatPrice(shippingCents, "CAD")
        }
        total={session ? formatPrice(totalCents, "CAD") : undefined}
      />

      <button
        type="button"
        className="tx-button tx-button--block"
        disabled={!session || submitting}
        onClick={() => void pay()}
      >
        {submitting ? "Processing…" : session ? `Pay ${formatPrice(totalCents, "CAD")}` : "Pay"}
      </button>
      <p className="checkout-fine-print">Payments are processed securely by Stripe.</p>
      {error && (
        <p className="tx-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// Radio list of the session's Stripe-Dashboard shipping rates; selecting one
// drives updateShippingOption, which re-prices the session.
function ShippingOptionPicker({
  options,
  selectedId,
  onSelect,
}: {
  options: StripeCheckoutShippingOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="checkout-shipping-options">
      <legend>Shipping method</legend>
      {options.map((opt) => (
        <label key={opt.id} className="checkout-shipping-option">
          <span className="checkout-shipping-option-name">
            <input
              type="radio"
              name="shipping-option"
              value={opt.id}
              checked={opt.id === selectedId}
              onChange={() => onSelect(opt.id)}
            />
            {opt.displayName ?? "Shipping"}
          </span>
          <span className="checkout-shipping-option-price">
            {opt.minorUnitsAmount === 0 ? "Free" : formatPrice(opt.minorUnitsAmount, "CAD")}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
