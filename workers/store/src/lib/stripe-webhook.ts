import Stripe from "stripe";

export const STORE_STRIPE_WEBHOOK_PATH = "/hooks/store";

export type StoreStripeEventMessage = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  objectId?: string;
};

export function stripeConfigured(
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SIGNING_SECRET">,
) {
  return Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SIGNING_SECRET);
}

function json(status: number, body: unknown) {
  return Response.json(body, { status });
}

export async function handleStoreStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (!stripeConfigured(env)) {
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

  const eventObject = event.data.object as { id?: unknown };
  await env.STRIPE_EVENTS.send({
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    objectId: typeof eventObject.id === "string" ? eventObject.id : undefined,
  } satisfies StoreStripeEventMessage);

  return json(200, { ok: true });
}
