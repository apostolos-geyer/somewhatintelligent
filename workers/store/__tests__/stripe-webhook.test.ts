import Stripe from "stripe";
import { handleStoreStripeWebhook, type StoreStripeEventMessage } from "../src/lib/stripe-webhook";

function env(overrides: Partial<Env> = {}): Env {
  const messages: StoreStripeEventMessage[] = [];
  return {
    STRIPE_SECRET_KEY: "sk_test_local",
    STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_test",
    STRIPE_EVENTS: {
      send: async (message: StoreStripeEventMessage) => {
        messages.push(message);
      },
      // test-only escape hatch
      messages,
    },
    ...overrides,
  } as unknown as Env;
}

function signedRequest(payload: object, secret = "whsec_test") {
  const body = JSON.stringify(payload);
  const stripe = new Stripe("sk_test_local");
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret });
  return new Request("https://store.test/hooks/store", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body,
  });
}

describe("handleStoreStripeWebhook", () => {
  test("returns 503 when Stripe is not configured", async () => {
    const res = await handleStoreStripeWebhook(
      new Request("https://store.test/hooks/store", { method: "POST" }),
      env({ STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SIGNING_SECRET: "" } as Partial<Env>),
    );
    expect(res.status).toBe(503);
  });

  test("returns 503 without throwing when the STRIPE_EVENTS queue binding is absent (preview build)", async () => {
    const testEnv = env({ STRIPE_EVENTS: undefined } as unknown as Partial<Env>);
    const payload = {
      id: "evt_no_queue",
      object: "event",
      created: 1_806_000_000,
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: "cs_test_456", object: "checkout.session" } },
    };

    const res = await handleStoreStripeWebhook(signedRequest(payload), testEnv);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: "queue_unconfigured" });
  });

  test("rejects unsigned requests without enqueueing", async () => {
    const testEnv = env();
    const res = await handleStoreStripeWebhook(
      new Request("https://store.test/hooks/store", { method: "POST", body: "{}" }),
      testEnv,
    );
    expect(res.status).toBe(400);
    expect((testEnv.STRIPE_EVENTS as unknown as { messages: unknown[] }).messages).toEqual([]);
  });

  test("verifies a Stripe signature and enqueues a compact event message", async () => {
    const testEnv = env();
    const payload = {
      id: "evt_checkout_completed",
      object: "event",
      api_version: "2026-02-03.preview",
      created: 1_806_000_000,
      type: "checkout.session.completed",
      livemode: false,
      data: { object: { id: "cs_test_123", object: "checkout.session", payment_status: "paid" } },
    };

    const res = await handleStoreStripeWebhook(signedRequest(payload), testEnv);

    expect(res.status).toBe(200);
    expect(
      (testEnv.STRIPE_EVENTS as unknown as { messages: StoreStripeEventMessage[] }).messages,
    ).toEqual([
      {
        id: "evt_checkout_completed",
        type: "checkout.session.completed",
        created: 1_806_000_000,
        livemode: false,
        objectId: "cs_test_123",
        payment_status: "paid",
      },
    ]);
  });
});
