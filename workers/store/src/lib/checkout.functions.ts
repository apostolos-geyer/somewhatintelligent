// Server-fn surface for the embedded Payment Element checkout (Stripe Checkout
// Sessions, ui_mode "elements"). The request-path logic lives in lib/checkout.ts
// (drivable in the pool tier); this wrapper resolves the DB, session, and env,
// injects the guestlist customer resolution + the real Stripe client, and
// exposes the two server functions the checkout UI calls. Stripe stays optional
// — the client is constructed only past the stripeConfigured gate, so keyless
// boot never reaches `new Stripe(...)`.
import type Stripe from "stripe";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { stripeConfigured } from "@somewhatintelligent/stripe";

import { getDb } from "@/lib/db";
import { requireAuthMiddleware } from "@/lib/middleware/auth";
import { makeStripeClient } from "@/lib/stripe-client";
import { placeOrderInput } from "@/lib/orders.functions";
import type { PlatformSession } from "@somewhatintelligent/auth";
import {
  createCheckoutSessionCore,
  getOrderByStripeSessionCore,
  type CheckoutInput,
  type CreateCheckoutSessionResult,
  type DahliaSessionCreateParams,
  type EnsureCustomerResult,
  type OrderByStripeSessionResult,
  type SessionExpirer,
  type StripeSessionCreator,
} from "@/lib/checkout";

export type { CreateCheckoutSessionResult, OrderByStripeSessionResult } from "@/lib/checkout";

// Get-or-create the buyer's Stripe Customer via guestlist's typed RPC,
// forwarding the inbound session cookie as the sole credential (never a
// client-supplied user id — INV-9). The guestlist entrypoint derives the
// acting user from the cookie and get-or-creates; the service binding is not
// a trust boundary. Any failure (unauthorized, stripe unconfigured, create
// failed) collapses to `{ ok: false }` here — the caller reverses cleanly.
async function ensureStripeCustomer(): Promise<EnsureCustomerResult> {
  const cookie = getRequest().headers.get("cookie") ?? "";
  const res = await env.GUESTLIST.ensureStripeCustomer({ cookie });
  if (!res.ok) return { ok: false };
  return { ok: true, stripeCustomerId: res.stripeCustomerId };
}

// One client per request, lazily built and shared between the session
// creator and the expirer (Track G3's supersede loop can call the expirer
// many times). Never invoked until createCheckoutSessionCore calls past the
// stripeConfigured gate, so keyless boot never reaches `new Stripe(...)`.
function makeStripeDeps(secretKey: string): {
  createStripeSession: StripeSessionCreator;
  expireSession: SessionExpirer;
} {
  let client: Stripe | undefined;
  const stripe = () => (client ??= makeStripeClient(secretKey));
  return {
    createStripeSession: (params: DahliaSessionCreateParams, options) =>
      stripe().checkout.sessions.create(
        params as unknown as Stripe.Checkout.SessionCreateParams,
        options,
      ),
    expireSession: async (sessionId: string) => {
      await stripe().checkout.sessions.expire(sessionId);
    },
  };
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireAuthMiddleware])
  .inputValidator((data: typeof placeOrderInput.infer) => placeOrderInput.assert(data))
  .handler(async ({ data, context }): Promise<CreateCheckoutSessionResult> => {
    const { createStripeSession, expireSession } = makeStripeDeps(env.STRIPE_SECRET_KEY);
    return createCheckoutSessionCore({
      db: getDb(),
      session: context.session as PlatformSession,
      input: data as CheckoutInput,
      env,
      ensureCustomer: ensureStripeCustomer,
      createStripeSession,
      expireSession,
    });
  });

// Server-derived flag the checkout route reads to decide which branch renders:
// the embedded Payment Element (true) or today's manual placeOrder form (false).
// Gates on the server secrets (same stripeConfigured gate as
// createCheckoutSession/the webhook route) AND the client-required publishable
// key, so the card form never renders when any piece of the flow is missing.
// Never returns the secret key — only the boolean.
export const getCheckoutConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ stripeEnabled: boolean }> => ({
    stripeEnabled:
      stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SIGNING_SECRET) &&
      Boolean(env.STRIPE_PUBLISHABLE_KEY),
  }),
);

export const getOrderByStripeSession = createServerFn({ method: "GET" })
  .middleware([requireAuthMiddleware])
  .inputValidator((data: { sessionId: string }) => type({ sessionId: "string" }).assert(data))
  .handler(async ({ data, context }): Promise<OrderByStripeSessionResult> => {
    return getOrderByStripeSessionCore(getDb(), context.session as PlatformSession, data.sessionId);
  });
