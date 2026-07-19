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
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { PlatformSession } from "@somewhatintelligent/auth";
import {
  createCheckoutSessionCore,
  getOrderByStripeSessionCore,
  type CheckoutInput,
  type CheckoutSessionDeps,
  type EnsureCustomer,
  type SessionExpirer,
  type ShippingRateLister,
  type ShippingRateOption,
  type StripeSessionCreator,
} from "@/lib/checkout";
import { db, seedOrder, seedOrderItem, seedProduct, seedVariant, stockOf } from "./helpers";

const { productBase, productDraft, productVariant, customerOrder, orderItem } = schema;

const STRIPE_ENV = {
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x",
  STORE_URL: "https://store.somewhatintelligent.localhost",
} satisfies CheckoutSessionDeps["env"];

const session = (id = "buyer-1"): PlatformSession =>
  ({ user: { id, email: `${id}@example.com`, role: "user" } }) as unknown as PlatformSession;

const okCustomer: EnsureCustomer = async () => ({ ok: true, stripeCustomerId: "cus_test_1" });

// Default supersede authority for the tests that seed no prior open attempt for
// the caller — the supersede SELECT returns nothing, so this is never invoked.
// The supersede-specific tests below inject their own spy/throwing expirer.
const noExpire: SessionExpirer = async () => {};

// Default rate lister: no Dashboard rates, so the session falls back to the
// built-in flat rate. The rates-specific test injects its own lister.
const noRates: ShippingRateLister = async () => [];

// Seed a prior open checkout attempt for a user: a pending/unpaid order carrying
// a session id + one reserved line, exactly the shape the supersede sweep
// targets. `stock` on the variant is assumed already decremented for this
// reservation by the caller's seedVariant.
async function seedPriorAttempt(opts: {
  orderId: string;
  sessionId: string | null;
  userId?: string;
  productId: string;
  variantId: string;
  quantity: number;
  status?: "pending" | "cancelled" | "paid";
  paymentStatus?: string;
}) {
  await seedOrder({
    id: opts.orderId,
    userId: opts.userId,
    status: opts.status,
    paymentStatus: opts.paymentStatus,
    // Stripe-path shaped (INV-11): a resolved customer id is always present.
    stripeCustomerId: "cus_prior",
    stripeCheckoutSessionId: opts.sessionId,
    subtotalCents: 3000,
    totalCents: 3000,
  });
  await seedOrderItem({
    id: `oi-${opts.orderId}`,
    orderId: opts.orderId,
    productId: opts.productId,
    variantId: opts.variantId,
    titleSnapshot: "Tee",
    unitPriceCents: 3000,
    quantity: opts.quantity,
  });
}

async function orderById(id: string) {
  const [row] = await db.select().from(customerOrder).where(eq(customerOrder.id, id));
  return row;
}

const input = (over: Partial<CheckoutInput> = {}): CheckoutInput => ({
  items: [{ variantId: "v1", quantity: 3 }],
  ...over,
});

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(productBase);
});

describe("createCheckoutSessionCore", () => {
  it("happy path: writes order + items + reserved stock, attaches session id after Stripe returns", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
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
      expireSession: noExpire,
      listShippingRates: noRates,
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
      // Address is NULL at creation — Stripe collects it during payment and the
      // completed webhook backfills it. shipCountry keeps its "CA" default.
      shipName: null,
      shipLine1: null,
      shipLine2: null,
      shipCity: null,
      shipRegion: null,
      shipPostal: null,
      shipCountry: "CA",
      shipPhone: null,
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
    await seedProduct({ id: "p1", priceCents: 2500 });
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
      expireSession: noExpire,
      listShippingRates: noRates,
    });

    const [params] = createStripeSession.mock.calls[0]!;
    const [line] = params.line_items!;
    expect((line as { price_data: { unit_amount: number } }).price_data.unit_amount).toBe(2500);
  });

  it("Dashboard rates: applicable set (filtered, sorted, capped at 5) rides shipping_options; default rate is the provisional shippingCents", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    // subtotal = 3 × 3000 = 9000. shr_hi is filtered (threshold above subtotal);
    // the remaining six sort cheapest-first and cap to five (shr_6 drops).
    const rates: ShippingRateOption[] = [
      { id: "shr_6", amountCents: 600, minSubtotalCents: 0 },
      { id: "shr_1", amountCents: 100, minSubtotalCents: 0 },
      { id: "shr_5", amountCents: 500, minSubtotalCents: 0 },
      { id: "shr_2", amountCents: 200, minSubtotalCents: 0 },
      { id: "shr_hi", amountCents: 50, minSubtotalCents: 100_000 },
      { id: "shr_4", amountCents: 400, minSubtotalCents: 0 },
      { id: "shr_3", amountCents: 300, minSubtotalCents: 0 },
    ];

    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_rates",
      client_secret: "cs_rates_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession: noExpire,
      listShippingRates: async () => rates,
    });

    const [params] = createStripeSession.mock.calls[0]!;
    expect(params.shipping_options).toEqual([
      { shipping_rate: "shr_1" },
      { shipping_rate: "shr_2" },
      { shipping_rate: "shr_3" },
      { shipping_rate: "shr_4" },
      { shipping_rate: "shr_5" },
    ]);

    // Provisional totals use the default (cheapest) rate; the webhook finalizes.
    const [order] = await db.select().from(customerOrder);
    expect(order!.shippingCents).toBe(100);
    expect(order!.totalCents).toBe(9100);
  });

  it("Stripe sessions.create throws: reservation fully reversed, order cancelled, no session id", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
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
      expireSession: noExpire,
      listShippingRates: noRates,
    });

    expect(result).toEqual({ ok: false, error: "stripe_session_failed" });

    // Stock back to its pre-call value; the order row remains but cancelled,
    // never carrying a session id.
    expect(await stockOf("v1")).toBe(10);
    const [order] = await db.select().from(customerOrder);
    expect(order).toMatchObject({ status: "cancelled", stripeCheckoutSessionId: null });
  });

  it("out_of_stock from the reservation guard: no order row written", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 2 });

    const createStripeSession = vi.fn();
    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession: noExpire,
      listShippingRates: noRates,
    });

    expect(result).toMatchObject({ ok: false, error: "out_of_stock" });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(2);
  });

  it("stub mode (Stripe unconfigured): zero writes, zero Stripe/customer calls", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const createStripeSession = vi.fn();
    const ensureCustomer = vi.fn<EnsureCustomer>();
    const expireSession = vi.fn<SessionExpirer>();
    const listShippingRates = vi.fn<ShippingRateLister>();

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
      expireSession,
      listShippingRates,
    });

    expect(result).toEqual({ ok: true, mode: "stub" });
    expect(ensureCustomer).not.toHaveBeenCalled();
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(expireSession).not.toHaveBeenCalled();
    expect(listShippingRates).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(10);
  });

  it("stripe_customer_failed: customer resolution fails before any reservation", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 10 });

    const createStripeSession = vi.fn();
    const result = await createCheckoutSessionCore({
      db,
      session: session(),
      input: input(),
      env: STRIPE_ENV,
      ensureCustomer: async () => ({ ok: false }),
      createStripeSession,
      expireSession: noExpire,
      listShippingRates: noRates,
    });

    expect(result).toEqual({ ok: false, error: "stripe_customer_failed" });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(10);
  });
});

describe("createCheckoutSessionCore — sources price/title from the active release", () => {
  // The Stripe line item the mocked session creator received: its D1-computed
  // unit amount and the product name (release title + variant size).
  const firstLine = (createStripeSession: ReturnType<typeof vi.fn<StripeSessionCreator>>) => {
    const [params] = createStripeSession.mock.calls[0]!;
    return params.line_items![0] as {
      price_data: { unit_amount: number; product_data: { name: string } };
    };
  };
  const okSession = (id: string) =>
    vi.fn<StripeSessionCreator>(async () => ({
      id,
      client_secret: `${id}_secret`,
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));
  const run = (createStripeSession: StripeSessionCreator, over: Partial<CheckoutInput> = {}) =>
    createCheckoutSessionCore({
      db,
      session: session(),
      input: input({ items: [{ variantId: "v1", quantity: 1 }], ...over }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession: noExpire,
      listShippingRates: noRates,
    });

  it("prices from the active RELEASE, not the draft, and snapshots the release title/price", async () => {
    // Release title/price are authoritative; the draft carries a stale rename +
    // higher price that must never reach checkout or the order snapshot.
    await seedProduct({
      id: "p1",
      title: "Field Tee",
      priceCents: 4200,
      draftTitle: "DRAFT rename",
      draftPriceCents: 9999,
    });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });

    const createStripeSession = okSession("cs_rel");
    const result = await run(createStripeSession);
    expect(result).toMatchObject({ ok: true, mode: "elements" });

    // Stripe sees the release price + release title, never the draft's.
    const line = firstLine(createStripeSession);
    expect(line.price_data.unit_amount).toBe(4200);
    expect(line.price_data.product_data.name).toBe("Field Tee (M)");

    // order_item snapshots the release title/price + the live variant size/ids
    // at order creation (INV-ORDER-1).
    const [order] = await db.select().from(customerOrder);
    expect(order!.subtotalCents).toBe(4200);
    const [item] = await db.select().from(orderItem).where(eq(orderItem.orderId, order!.id));
    expect(item).toMatchObject({
      titleSnapshot: "Field Tee",
      sizeSnapshot: "M",
      unitPriceCents: 4200,
      variantId: "v1",
      productId: "p1",
      quantity: 1,
    });
  });

  it("a draft price/title edit after publish does not change the checkout price", async () => {
    await seedProduct({ id: "p1", title: "Field Tee", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });
    // Operator edits the draft after publishing; the active release is untouched,
    // so checkout still prices from the release.
    await db
      .update(productDraft)
      .set({ priceCents: 8000, title: "Draft Rename" })
      .where(eq(productDraft.productId, "p1"));

    const createStripeSession = okSession("cs_draft");
    await run(createStripeSession);

    const line = firstLine(createStripeSession);
    expect(line.price_data.unit_amount).toBe(3000);
    expect(line.price_data.product_data.name).toBe("Field Tee (M)");
  });

  it("ignores a forged cart price/title — only variantId + quantity are honored (INV-CART-1)", async () => {
    await seedProduct({ id: "p1", title: "Field Tee", priceCents: 2500 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });

    const createStripeSession = okSession("cs_forge");
    // A tampered cart line smuggles a price + title; the core reads neither — it
    // re-loads the release by variantId and reprices.
    const forged = {
      items: [
        { variantId: "v1", quantity: 1, unitPriceCents: 1, priceCents: 1, title: "FREE STUFF" },
      ],
    } as unknown as CheckoutInput;
    await run(createStripeSession, forged);

    const line = firstLine(createStripeSession);
    expect(line.price_data.unit_amount).toBe(2500);
    expect(line.price_data.product_data.name).toBe("Field Tee (M)");
    const [order] = await db.select().from(customerOrder);
    expect(order!.subtotalCents).toBe(2500);
  });

  it("product with no active release is product_unavailable (never priced from the draft)", async () => {
    // A draft-only product (published pointer never advanced) cannot be sold.
    await seedProduct({ id: "p1", priceCents: 3000, withRelease: false });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });

    const createStripeSession = vi.fn<StripeSessionCreator>();
    const result = await run(createStripeSession);
    expect(result).toMatchObject({ ok: false, error: "product_unavailable" });
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(await db.select().from(customerOrder)).toHaveLength(0);
    expect(await stockOf("v1")).toBe(5);
  });

  it("two concurrent stock-one checkouts commit exactly one order (INV-STOCK-1)", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 1 });

    // Two DISTINCT buyers so the one-open-session supersede sweep never crosses
    // them; both contend for the single unit through the guarded reservation.
    const runFor = (user: string) =>
      createCheckoutSessionCore({
        db,
        session: session(user),
        input: input({ items: [{ variantId: "v1", quantity: 1 }] }),
        env: STRIPE_ENV,
        ensureCustomer: okCustomer,
        createStripeSession: okSession(`cs_${user}`),
        expireSession: noExpire,
        listShippingRates: noRates,
      });

    const outcomes = await Promise.all([runFor("buyer-1"), runFor("buyer-2")]);
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    expect(outcomes.find((r) => !r.ok)).toMatchObject({ ok: false, error: "out_of_stock" });

    // Exactly one order committed; the last unit went to one winner; never negative.
    expect(await db.select().from(customerOrder)).toHaveLength(1);
    expect(await stockOf("v1")).toBe(0);
  });
});

describe("createCheckoutSessionCore — supersede prior open attempts (Track G3)", () => {
  it("expires the caller's prior open attempt, releases its stock, and the new attempt reserves only its own", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    // Original stock 10; the prior attempt already reserved 3 → 7 on hand.
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 7 });
    await seedPriorAttempt({
      orderId: "ord_prior",
      sessionId: "cs_prior",
      productId: "p1",
      variantId: "v1",
      quantity: 3,
    });

    const expireSession = vi.fn<SessionExpirer>(async () => {});
    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_new",
      client_secret: "cs_new_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    const result = await createCheckoutSessionCore({
      db,
      session: session("buyer-1"),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession,
      listShippingRates: noRates,
    });

    expect(result).toMatchObject({ ok: true, mode: "elements", clientSecret: "cs_new_secret" });

    // The prior session was expired at Stripe (authority), exactly once.
    expect(expireSession).toHaveBeenCalledTimes(1);
    expect(expireSession).toHaveBeenCalledWith("cs_prior");

    // The prior order is released + cancelled; its stock returned.
    const prior = await orderById("ord_prior");
    expect(prior).toMatchObject({ status: "cancelled", paymentStatus: "expired" });

    // A single new pending order carries the new session id.
    const orders = await db.select().from(customerOrder);
    expect(orders).toHaveLength(2);
    const fresh = orders.find((o) => o.id !== "ord_prior")!;
    expect(fresh).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      stripeCheckoutSessionId: "cs_new",
    });

    // Net stock held = the new attempt only (10 − 3), not both attempts.
    expect(await stockOf("v1")).toBe(7);
  });

  it("expireSession throws (session completing at Stripe): the prior order is untouched, the new attempt still succeeds", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    // Original 10; prior holds 3 → 7 on hand.
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 7 });
    await seedPriorAttempt({
      orderId: "ord_prior",
      sessionId: "cs_prior",
      productId: "p1",
      variantId: "v1",
      quantity: 3,
    });

    const expireSession = vi.fn<SessionExpirer>(async () => {
      throw new Error("session is not open");
    });
    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_new",
      client_secret: "cs_new_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    const result = await createCheckoutSessionCore({
      db,
      session: session("buyer-1"),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession,
      listShippingRates: noRates,
    });

    // A supersede failure never blocks the new checkout.
    expect(result).toMatchObject({ ok: true, mode: "elements" });
    expect(expireSession).toHaveBeenCalledWith("cs_prior");

    // The prior order is left COMPLETELY untouched — never released on D1 state
    // alone; the webhook/cron settles it.
    const prior = await orderById("ord_prior");
    expect(prior).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      stripeCheckoutSessionId: "cs_prior",
    });

    // Both reservations still held: prior 3 + new 3 out of 10 → 4.
    expect(await stockOf("v1")).toBe(4);
  });

  it("never touches another user's pending attempt", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    // buyer-2 holds 3 of 10 → 7 on hand.
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 7 });
    await seedPriorAttempt({
      orderId: "ord_other",
      sessionId: "cs_other",
      userId: "buyer-2",
      productId: "p1",
      variantId: "v1",
      quantity: 3,
    });

    const expireSession = vi.fn<SessionExpirer>(async () => {});
    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_new",
      client_secret: "cs_new_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    const result = await createCheckoutSessionCore({
      db,
      session: session("buyer-1"),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession,
      listShippingRates: noRates,
    });

    expect(result).toMatchObject({ ok: true, mode: "elements" });
    // buyer-2's session is never expired.
    expect(expireSession).not.toHaveBeenCalled();

    const other = await orderById("ord_other");
    expect(other).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      stripeCheckoutSessionId: "cs_other",
    });
    // buyer-2 (3) + buyer-1's new (3) both held out of 10 → 4.
    expect(await stockOf("v1")).toBe(4);
  });

  it("never touches an orphan (no session id) — that belongs to the cron", async () => {
    await seedProduct({ id: "p1", priceCents: 3000 });
    // The orphan holds 3 of 10 → 7 on hand.
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 7 });
    await seedPriorAttempt({
      orderId: "ord_orphan",
      sessionId: null,
      productId: "p1",
      variantId: "v1",
      quantity: 3,
    });

    const expireSession = vi.fn<SessionExpirer>(async () => {});
    const createStripeSession = vi.fn<StripeSessionCreator>(async () => ({
      id: "cs_new",
      client_secret: "cs_new_secret",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
    }));

    const result = await createCheckoutSessionCore({
      db,
      session: session("buyer-1"),
      input: input({ items: [{ variantId: "v1", quantity: 3 }] }),
      env: STRIPE_ENV,
      ensureCustomer: okCustomer,
      createStripeSession,
      expireSession,
      listShippingRates: noRates,
    });

    expect(result).toMatchObject({ ok: true, mode: "elements" });
    // An orphan has no session id to expire.
    expect(expireSession).not.toHaveBeenCalled();

    const orphan = await orderById("ord_orphan");
    expect(orphan).toMatchObject({
      status: "pending",
      paymentStatus: "unpaid",
      stripeCheckoutSessionId: null,
    });
    // Orphan (3) + new (3) both held out of 10 → 4.
    expect(await stockOf("v1")).toBe(4);
  });
});

describe("getOrderByStripeSessionCore", () => {
  async function seedAttachedOrder(sessionId: string, userId: string) {
    await seedOrder({
      id: `o-${sessionId}`,
      orderNumber: `SI-${sessionId}`,
      userId,
      stripeCheckoutSessionId: sessionId,
      subtotalCents: 3000,
      totalCents: 3000,
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
