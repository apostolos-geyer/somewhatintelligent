/**
 * Post-payment landing island (Stripe redirects here with ?session_id=…). UX
 * only, never authoritative — fulfillment is driven by the webhook consumer, so
 * this polls the checkout-session status via store-api-client until it reaches a
 * terminal state, then clears the local cart on success. Replaces the vendored
 * TanStack search-params + server-fn plumbing.
 */
import { useEffect, useRef, useState } from "react";
import { fetchCheckoutStatus } from "../../lib/store-api-client";
import { clearCart } from "../../lib/cart-client";

type Phase = "loading" | "success" | "pending" | "failed" | "error";

const MAX_ATTEMPTS = 8;
const POLL_MS = 2000;

export default function CheckoutReturn() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clearedRef = useRef(false);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id");
    if (!sessionId) {
      setError("Missing checkout session.");
      setPhase("error");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const showError = (message: string) => {
      setError(message);
      setPhase("error");
    };

    const poll = async (attempt: number): Promise<void> => {
      const res = await fetchCheckoutStatus(sessionId);
      if (cancelled) return;

      if (!res.ok) {
        if (res.error === "unauthorized") {
          showError("Please sign in to view this order.");
          return;
        }
        // A freshly-created session may not be linked yet; retry a few times.
        if (attempt < MAX_ATTEMPTS) {
          timer = setTimeout(() => void poll(attempt + 1), POLL_MS);
          return;
        }
        showError(res.error === "not_found" ? "Order not found." : "Could not confirm your order.");
        return;
      }

      if (res.state === "paid") {
        if (!clearedRef.current) {
          clearedRef.current = true;
          clearCart();
        }
        setOrderNumber(res.orderNumber);
        setPhase("success");
        return;
      }
      if (res.state === "failed") {
        setPhase("failed");
        return;
      }
      // pending
      if (attempt < MAX_ATTEMPTS) {
        setOrderNumber(res.orderNumber);
        timer = setTimeout(() => void poll(attempt + 1), POLL_MS);
        return;
      }
      setOrderNumber(res.orderNumber);
      setPhase("pending");
    };

    void poll(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (phase === "error") {
    return (
      <p className="tx-error" role="alert">
        {error}
      </p>
    );
  }

  if (phase === "success") {
    return (
      <div>
        <p>Payment received. Thank you.</p>
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

  if (phase === "failed") {
    return (
      <div>
        <p>We could not confirm your payment.</p>
        <p className="tx-status">
          <a href="/cart/">
            Return to cart <span aria-hidden="true">→</span>
          </a>
        </p>
      </div>
    );
  }

  if (phase === "pending") {
    return (
      <div>
        <p>
          Your payment is still processing. This can take a moment — you can safely leave this page
          and check your order later.
        </p>
        {orderNumber && (
          <p className="tx-order-number">
            Order <strong>{orderNumber}</strong>
          </p>
        )}
      </div>
    );
  }

  return (
    <p className="tx-status" aria-live="polite">
      Confirming your payment…
    </p>
  );
}
