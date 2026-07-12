// Server-fn surface for the embedded Payment Element checkout (Stripe Checkout
// Sessions, ui_mode "elements"). The request-path logic lives in lib/checkout.ts
// (drivable in the pool tier); this wrapper resolves the DB, session, and env,
// injects the guestlist customer resolution + the real Stripe client, and
// exposes the two server functions the checkout UI calls. Stripe stays optional
// — the client is constructed only past the stripeConfigured gate, so keyless
// boot never reaches `new Stripe(...)`.
import Stripe from "stripe";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { stripeConfigured } from "@somewhatintelligent/stripe";

import { getDb } from "@/lib/db";
import { requireAuthMiddleware } from "@/lib/middleware/auth";
import type { PlatformSession } from "@somewhatintelligent/auth";
import {
  createCheckoutSessionCore,
  getOrderByStripeSessionCore,
  type CheckoutInput,
  type CreateCheckoutSessionResult,
  type DahliaSessionCreateParams,
  type EnsureCustomerResult,
  type OrderByStripeSessionResult,
  type StripeSessionCreator,
} from "@/lib/checkout";

export type { CreateCheckoutSessionResult, OrderByStripeSessionResult } from "@/lib/checkout";

// The endpoint (and this client) target Stripe API 2026-06-24.dahlia. Typed as
// a plain string so it narrows to the SDK's LatestApiVersion literal at the
// construction site — stripe@20.4.1's bundled type predates this version.
const STRIPE_API_VERSION: string = "2026-06-24.dahlia";

const GUESTLIST_INTERNAL = "http://guestlist.internal";

// Mirrors placeOrder's input (orders.functions.ts) — the Stripe checkout path
// validates the identical cart shape. Declared locally so this stage does not
// modify the order-fn module it does not own.
const shippingSchema = type({
  name: "2 <= string <= 120",
  line1: "1 <= string <= 160",
  "line2?": "string <= 160",
  city: "1 <= string <= 80",
  region: "1 <= string <= 80",
  postal: "1 <= string <= 20",
  "country?": "string <= 2",
  "phone?": "string <= 40",
});

const placeOrderInput = type({
  items: type({ variantId: "string", quantity: "1 <= number.integer <= 99" })
    .array()
    .atLeastLength(1),
  shipping: shippingSchema,
});

// Get-or-create the buyer's Stripe Customer via guestlist, forwarding the
// inbound session cookie (never a client-supplied user id — INV-9). Mirrors
// identity's invitation.functions.ts service-binding call.
async function ensureStripeCustomer(): Promise<EnsureCustomerResult> {
  const inbound = getRequest().headers;
  const headers: Record<string, string> = {};
  const cookie = inbound.get("cookie");
  if (cookie) headers.cookie = cookie;
  const origin = inbound.get("origin");
  if (origin) headers.origin = origin;

  const url = new URL("/api/stripe/ensure-customer", GUESTLIST_INTERNAL);
  const res = await env.GUESTLIST.fetch(new Request(url.toString(), { method: "POST", headers }));
  if (res.status !== 200) return { ok: false };
  const body = (await res.json()) as { stripeCustomerId?: string };
  if (!body.stripeCustomerId) return { ok: false };
  return { ok: true, stripeCustomerId: body.stripeCustomerId };
}

// Constructed only past the stripeConfigured gate, so STRIPE_SECRET_KEY is
// present — keyless boot never reaches `new Stripe(...)`.
function makeStripeSessionCreator(secretKey: string): StripeSessionCreator {
  return async (params: DahliaSessionCreateParams, options) => {
    const stripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
    });
    return stripe.checkout.sessions.create(
      params as unknown as Stripe.Checkout.SessionCreateParams,
      options,
    );
  };
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireAuthMiddleware])
  .inputValidator((data: typeof placeOrderInput.infer) => placeOrderInput.assert(data))
  .handler(async ({ data, context }): Promise<CreateCheckoutSessionResult> => {
    return createCheckoutSessionCore({
      db: getDb(),
      session: context.session as PlatformSession,
      input: data as CheckoutInput,
      env,
      ensureCustomer: ensureStripeCustomer,
      createStripeSession: makeStripeSessionCreator(env.STRIPE_SECRET_KEY),
    });
  });

// Server-derived flag the checkout route reads to decide which branch renders:
// the embedded Payment Element (true) or today's manual placeOrder form (false).
// Uses the same stripeConfigured gate as createCheckoutSession/the webhook route,
// so the client can never present a card form when the server can't complete a
// Stripe checkout. Never returns the secret key — only the boolean.
export const getCheckoutConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ stripeEnabled: boolean }> => ({
    stripeEnabled: stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SIGNING_SECRET),
  }),
);

export const getOrderByStripeSession = createServerFn({ method: "GET" })
  .middleware([requireAuthMiddleware])
  .inputValidator((data: { sessionId: string }) => type({ sessionId: "string" }).assert(data))
  .handler(async ({ data, context }): Promise<OrderByStripeSessionResult> => {
    return getOrderByStripeSessionCore(getDb(), context.session as PlatformSession, data.sessionId);
  });
