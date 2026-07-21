/**
 * Top-level checkout island (mounted `client:only="react"` inside TxShell).
 * Fetches the public store config, redirects an empty cart back to /cart, then
 * gates on `stripeEnabled`: the embedded Stripe Payment Element flow, or the
 * stub confirmation when Stripe is unconfigured (the store places the order
 * directly and returns an order number). Replaces the vendored TanStack loader
 * + server-fn plumbing with store-api-client calls and plain navigation.
 */
import { useEffect, useRef, useState } from "react";
import type { StorePublicConfig } from "@si/contracts";
import { readCart, clearCart } from "../../lib/cart-client";
import { fetchStoreConfig, createCheckoutSession } from "../../lib/store-api-client";
import { StripeCheckout } from "./StripeCheckout";
import { errorMessage } from "./parts";
import { useCart } from "./use-cart";

type ConfigState = "loading" | "unavailable" | StorePublicConfig;

export default function CheckoutIsland() {
  const { lines, subtotalCents } = useCart();
  const [config, setConfig] = useState<ConfigState>("loading");

  // Redirect only when the cart is empty at load — reading storage directly (not
  // the reactive lines) so a later clearCart on stub confirmation never bounces
  // the buyer off the confirmation view.
  useEffect(() => {
    if (readCart().lines.length === 0) window.location.replace("/cart/");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchStoreConfig().then((c) => {
      if (!cancelled) setConfig(c ?? "unavailable");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (config === "loading") {
    return (
      <p className="tx-status" aria-live="polite">
        Preparing checkout…
      </p>
    );
  }
  if (config === "unavailable") {
    return (
      <p className="tx-error" role="alert">
        Could not load checkout configuration.
      </p>
    );
  }

  if (config.stripeEnabled && config.stripePublishableKey) {
    return (
      <StripeCheckout
        lines={lines}
        subtotalCents={subtotalCents}
        publishableKey={config.stripePublishableKey}
      />
    );
  }

  return <ManualCheckout />;
}

// Stub fallback: with Stripe unconfigured the store places the order on the
// checkout-session call and returns its number. No address form and no
// functional manual payment path (that needs a new store endpoint) — just the
// confirmation the vanilla `#checkout-stub` rendered.
function ManualCheckout() {
  const [phase, setPhase] = useState<"placing" | "done" | "error">("placing");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const cart = readCart();
      if (cart.lines.length === 0) {
        setError("Your cart is empty.");
        setPhase("error");
        return;
      }
      const result = await createCheckoutSession(cart);
      if (result.ok === false) {
        setError(errorMessage(result.error));
        setPhase("error");
        return;
      }
      if (result.mode === "stub") {
        clearCart();
        setOrderNumber(result.orderNumber);
        setPhase("done");
        return;
      }
      setError("Checkout is unavailable right now.");
      setPhase("error");
    })();
  }, []);

  if (phase === "placing") {
    return (
      <p className="tx-status" aria-live="polite">
        Placing your order…
      </p>
    );
  }
  if (phase === "error") {
    return (
      <p className="tx-error" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div>
      <p>Payments are not configured in this environment, so your order was placed directly.</p>
      {orderNumber && (
        <p className="tx-order-number">
          Order <strong>{orderNumber}</strong>
        </p>
      )}
      {orderNumber && (
        <a className="tx-button" href={`/orders/${encodeURIComponent(orderNumber)}`}>
          View order <span aria-hidden="true">→</span>
        </a>
      )}
    </div>
  );
}
