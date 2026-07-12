/**
 * D1 integration (real local D1 via miniflare): createCheckoutSession's write
 * path. The pool harness binds ONLY D1 — no guestlist RPC, no request context,
 * no Stripe — so we drive the extracted request-path core
 * (createCheckoutSessionCore) with the customer resolution and the Stripe
 * sessions.create call injected as mocks, against a REAL D1. That proves the
 * load-bearing DB invariants: the order + items + reserved stock commit, the
 * session id is attached after Stripe returns (INV-2), a Stripe failure fully
 * reverses the reservation (Track C3), and the unconfigured gate writes nothing
 * (INV-7). Mirrors place-order.itest.ts / reservation.itest.ts.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { PlatformSession } from "@somewhatintelligent/auth";
import {
  createCheckoutSessionCore,
  getOrderByStripeSessionCore,
  type CheckoutInput,
  type CheckoutSessionDeps,
  type EnsureCustomer,
  type StripeSessionCreator,
} from "@/lib/checkout";

const { product, productVariant, customerOrder, orderItem } = schema;
const db = drizzle(env.DB, { schema });

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x",
  STORE_URL: "https://store.somewhatintelligent.localhost",
} satisfies CheckoutSessionDeps["env"];

const session = (id = "buyer-1"): PlatformSession =>
  ({ user: { id, email: `${id}@example.com`, role: "user" } }) as unknown as PlatformSession;

const okCustomer: EnsureCustomer = async () => ({ ok: true, stripeCustomerId: "cus_test_1" });

async function seedProduct(id: string, priceCents: number) {
  const now = new Date();
  await db.insert(product).values({
    id,
    slug: `slug-${id}`,
    title: `Tee ${id}`,
    priceCents,
    status: "active",
    createdBy: "admin",
    createdAt: now,
    updatedAt: now,
  });
}
async function seedVariant(opts: { id: string; productId: string; size: string; stock: number }) {
  await db.insert(productVariant).values({
    id: opts.id,
    productId: opts.productId,
    size: opts.size,
    sku: `SKU-${opts.id}`,
    stock: opts.stock,
    createdAt: new Date(),
  });
}
async function stockOf(variantId: string) {
  const [v] = await db.select().from(productVariant).where(eq(productVariant.id, variantId));
  return v!.stock;
}

const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  items: [{ variantId: "v1", quantity: 3 }],
  shipping: {
    name: "Ada Lovelace",
    line1: "1 Main",
    city: "Toronto",
    region: "ON",
    postal: "M5V",
  },
  ...over,
});

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
});

describe("createCheckoutSessionCore", () => {
  it("happy path: writes order + items + reserved stock, attaches session id after Stripe returns", async () => {
    await seedProduct("p1", 3000);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_test_happy",
      client_secret: "cs_test_happy_secret",
      expires_at: expiresAt,
    }));

    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
    });

    expect(result).toEqual({
      ok: true,
      mode: "elements",
      clientSecret: "cs_test_happy_secret",
      orderNumber: expect.stringMatching(/^SI-/),
    });

    // Exactly one order row, Stripe-path shaped: pending/unpaid, customer +
    // session id + expiry attached (INV-2/INV-11).
    const orders = await db.select().from(customerOrder);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      stripeCustomerId: "cus_test_1",
      stripeCheckoutSessionId: "cs_test_happy",
      subtotalCents: 9000,
      shippingCents: 0,
      totalCents: 9000,
    });
    expect(orders[0]!.stripeSessionExpiresAt).toBeInstanceOf(Date);
    expect(orders[0]!.stripeSessionExpiresAt!.getTime()).toBe(expiresAt * 1000);

    // One line item, stock reserved 10 → 7.
    const items = await db.select().from(orderItem).where(eq(orderItem.orderId, orders[0]!.id));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ variantId: "v1", quantity: 3, unitPriceCents: 3000 });
    expect(await stockOf("v1")).toBe(7);

    // The Session was built server-authoritatively: metadata.orderId links the
    // order, billing_address_collection is auto, shipping rides shipping_options
    // (not a line item), and the customer + idempotency key are set.
    expect(createStripeSession).toHaveBeenCalledTimes(1);
    const [params, options] = createStripeSession.mock.calls[0]!;
    expect(params.ui_mode).toBe("elements");
    expect(params.mode).toBe("payment");
    expect(params.customer).toBe("cus_test_1");
    expect(params.billing_address_collection).toBe("auto");
    expect(params.metadata).toEqual({ orderId: orders[0]!.id });
    expect(options.idempotencyKey).toBe(`checkout:${orders[0]!.id}`);
    expect(params.return_url).toBe(
      `${STRIPE_ENV.STORE_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          display_name: "Shipping",
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "cad" },
        },
      },
    ]);
    expect(params.line_items).toHaveLength(1);
  });

  it("prices from D1, not the client: line-item amount is the product price", async () => {
    await seedProduct("p1", 2500);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });

    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_price",
      client_secret: "cs_price_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    // A cart line carries only variantId + quantity — no price crosses the wire;
    // the amount Stripe sees is computed from the D1 product row.
    await createCheckoutSessionCore({
      db,
      session: session(),
      input: input({ items: [{ variantId: "v1", quantity: 1 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
    });

    const [params] = createStripeSession.mock.calls[0]!;
    const [line] = params.line_items!;
    expect((line as { price_data: { unit_amount: number } }).price_data.unit_amount).toBe(2500);
  });

  it("Stripe sessions.create throws: reservation fully reversed, order cancelled, no session id", async () => {
    await seedProduct("p1", 3000);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const createStripeSession = vi.fn<StripeSessionCreator>(async () => {
      throw new Error("stripe_down");
    });

    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
    });

    expect(result).toEqual({ ok: false, error: "stripe_session_failed" });

    // Stock back to its pre-call value; the order row remains but cancelled,
    // never carrying a session id.
    expect(await stockOf("v1")).toBe(10);
    const [order] = await db.select().from(customerOrder);
    expect(order).toMatchObject({ status: "cancelled", stripeCheckoutSessionId: null });
  });

  it("out_of_stock from the reservation guard: no order row written", async () => {
    await seedProduct("p1", 3000);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 2 });

    const createStripeSession = vi.fn();
    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
    });

    expect(result).toMatchObject({ ok: false, error: "out_of_stock" });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(2);
  });

  it("stub mode (Stripe unconfigured): zero writes, zero Stripe/customer calls", async () => {
    await seedProduct("p1", 3000);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const createStripeSession = vi.fn();
    const ensureCustomer = vi.fn<EnsureCustomer>();

    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: {
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SIGNING_SECRET: "",
        STORE_URL: STRIPE_ENV.STORE_URL,
      },
      ensureCustomer,
      createStripeSession,
    });

    expect(result).toEqual({ ok: true, mode: "stub" });
    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(10);
  });

  it("stripe_customer_failed: customer resolution fails before any reservation", async () => {
    await seedProduct("p1", 3000);
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const createStripeSession = vi.fn();
    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: STRIPE_ENV,
      ensureCustomer: async () => ({ ok: false }),
      createStripeSession,
    });

    expect(result).toEqual({ ok: false, error: "stripe_customer_failed" });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(10);
  });
});

describe("getOrderByStripeSessionCore", () => {
  async function seedAttachedOrder(sessionId: string, userId: string) {
    const now = new Date();
    await db.insert(customerOrder).values({
      id: `o-${sessionId}`,
      orderNumber: `SI-${sessionId}`,
      userId,
      email: `${userId}@example.com`,
      status: "pending",
      paymentStatus: "unpaid",
      shipName: "Ada",
      shipLine1: "1 Main",
      shipCity: "Toronto",
      shipRegion: "ON",
      shipPostal: "M5V",
      subtotalCents: 3000,
      totalCents: 3000,
      stripeCheckoutSessionId: sessionId,
      createdAt: now,
      updatedAt: now,
    });
  }

  it("owner sees the current status/paymentStatus", async () => {
    await seedAttachedOrder("cs_owner", "buyer-1");
    const res = await getOrderByStripeSessionCore(db, session("buyer-1"), "cs_owner");
    expect(res).toEqual({
      ok: true,
      orderNumber: "SI-cs_owner",
      status: "pending",
      paymentStatus: "unpaid",
    });
  });

  it("cross-user lookup collapses to not_found (never confirms existence)", async () => {
    await seedAttachedOrder("cs_owner", "buyer-1");
    const res = await getOrderByStripeSessionCore(db, session("stranger"), "cs_owner");
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("unknown session id → not_found", async () => {
    const res = await getOrderByStripeSessionCore(db, session("buyer-1"), "cs_missing");
    expect(res).toEqual({ ok: false, error: "not_found" });
  });
});
