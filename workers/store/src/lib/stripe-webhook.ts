import Stripe from "stripe";
import { stripeConfigured } from "@si/stripe";

export const STORE_STRIPE_WEBHOOK_PATH = "/hooks/store";

export type StoreStripeEventMessage = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  objectId?: string;
  // Snapshot of the checkout session's payment_status at emit time ("paid" /
  // "unpaid" / "no_payment_required"). Carried so the queue consumer settles
  // the order without a network re-fetch. See lib/stripe-events.ts.
  payment_status?: string;
};

// STRIPE_EVENTS is wrangler-generated, not hand-declared in env.d.ts (that hand
// decl previously kept asserting the binding even when the preview build strips
// `queues` — green typecheck, runtime `undefined.send()`). Treat it as
// optionally present via a local structural cast, mirroring platform.ts's
// binding-cast pattern, and preserve the payload type at this, the sole
// producer call site.
type StripeEventsEnv = { STRIPE_EVENTS?: Queue<StoreStripeEventMessage> };

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

export async function handleStoreStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SIGNING_SECRET)) {
    return json(503, { ok: false, error: "stripe_unconfigured" });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return json(400, { ok: false, error: "missing_signature" });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    const stripe = new Stripe(env.STRIPE_SECRET_KEY);
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SIGNING_SECRET,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json(400, { ok: false, error: "invalid_signature" });
  }

  // Guard the (optional) queue binding AFTER signature verification, so unsigned
  // requests still 400 first. Absent binding (preview build) → graceful 503.
  const queue = (env as StripeEventsEnv).STRIPE_EVENTS;
  if (!queue) {
    return json(503, { ok: false, error: "queue_unconfigured" });
  }

  const eventObject = event.data.object as { id?: unknown; payment_status?: unknown };
  await queue.send({
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    objectId: typeof eventObject.id === "string" ? eventObject.id : undefined,
    payment_status:
      typeof eventObject.payment_status === "string" ? eventObject.payment_status : undefined,
  } satisfies StoreStripeEventMessage);

  return json(200, { ok: true });
}
