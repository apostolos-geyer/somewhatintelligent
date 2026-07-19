import type { CartV1 } from "./cart";
import type { ShippingAddress } from "./store-operator";

/**
 * The stable public Store HTTP API consumed by Astro cart/checkout islands
 * through Bouncer (RFC-0001 "Store public HTTP API" / D11). All JSON responses
 * use `Content-Type: application/json`. Authenticated routes derive the customer
 * exclusively from the Bouncer/Guestlist session boundary — they never accept a
 * `userId`, customer ID, or email as authority in the request body.
 */

/** `GET /api/store/config` — no secret, price ID, or customer identifier. */
export interface StorePublicConfig {
  currency: "CAD";
  stripeEnabled: boolean;
  stripePublishableKey: string | null;
  maxQuantityPerLine: 10;
}

/** `POST /api/store/checkout-sessions` request body. */
export interface CreateCheckoutSessionRequest {
  cart: CartV1;
}

export type CreateCheckoutSessionResponse =
  | {
      ok: true;
      mode: "stripe";
      orderNumber: string;
      clientSecret: string;
      returnUrl: string;
    }
  | {
      ok: true;
      mode: "stub";
      orderNumber: string;
    };

export interface CheckoutErrorResponse {
  ok: false;
  error:
    | "empty_cart"
    | "invalid_cart"
    | "product_unavailable"
    | "variant_unavailable"
    | "out_of_stock"
    | "stripe_customer_failed"
    | "stripe_session_failed";
  variantId?: string;
}

/** `GET /api/store/checkout-sessions/:sessionId` — owning customer only. */
export type CheckoutSessionStatusResponse =
  | { ok: true; state: "pending"; orderNumber: string }
  | { ok: true; state: "paid"; orderNumber: string }
  | { ok: true; state: "failed"; orderNumber: string };

/** `PATCH /api/store/orders/:orderNumber/shipping` request body. */
export type UpdateShippingRequest = ShippingAddress;
