/**
 * D1 integration (real local D1 via miniflare): the Stripe queue-consumer
 * ingestion path — processStoreStripeEvent's idempotency ledger, atomic order
 * mutation, livemode gate, and the async payment lifecycle. Ledger presence /
 * absence and order state are only provable against a real DB, so this runs in
 * the pool tier (`bun run test:pool`), mirroring place-order.itest.ts.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { processStoreStripeEvent, type ProcessStripeEventResult } from "@/lib/stripe-events";
import type { StoreStripeEventMessage } from "@/lib/stripe-webhook";

const { product, productVariant, customerOrder, orderItem, processedStripeEvent } = schema;
const db = drizzle(env.DB, { schema });

const STAGING = { ENVIRONMENT: "staging" } as const;
const PRODUCTION = { ENVIRONMENT: "production" } as const;

async function seedOrder(
  sessionId: string,
  opts: { status?: "pending" | "cancelled" | "paid"; paymentStatus?: string } = {},
) {
  const now = new Date();
  await db.insert(customerOrder).values({
    id: `o-${sessionId}`,
    orderNumber: `SI-${sessionId}`,
    userId: "buyer-1",
    email: "buyer@example.com",
    status: opts.status ?? "pending",
    paymentStatus: opts.paymentStatus ?? "unpaid",
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

// Seed a product + variant plus one order (with an order_item line) whose
// reserved stock the release path can hand back. `stock` is the CURRENT (post-
// reservation) value; releasing `quantity` restores `stock + quantity`.
async function seedReservedOrder(
  sessionId: string,
  opts: {
    variantId: string;
    quantity: number;
    stock: number;
    status?: "pending" | "cancelled" | "paid";
    paymentStatus?: string;
  },
) {
  const now = new Date();
  await db.insert(product).values({
    id: `p-${opts.variantId}`,
    slug: `slug-${opts.variantId}`,
    title: "Tee",
    priceCents: 1500,
    status: "active",
    createdBy: "admin",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(productVariant).values({
    id: opts.variantId,
    productId: `p-${opts.variantId}`,
    size: "M",
    sku: `sku-${opts.variantId}`,
    stock: opts.stock,
    createdAt: now,
  });
  await seedOrder(sessionId, { status: opts.status, paymentStatus: opts.paymentStatus });
  await db.insert(orderItem).values({
    id: `oi-${sessionId}`,
    orderId: `o-${sessionId}`,
    productId: `p-${opts.variantId}`,
    variantId: opts.variantId,
    titleSnapshot: "Tee",
    sizeSnapshot: "M",
    unitPriceCents: 1500,
    quantity: opts.quantity,
  });
}

async function stockOf(variantId: string) {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row?.stock;
}

function msg(overrides: Partial<StoreStripeEventMessage> = {}): StoreStripeEventMessage {
  return {
    id: "evt_x",
    type: "checkout.session.completed",
    created: 0,
    livemode: false,
    objectId: "cs_x",
    payment_status: "paid",
    // Our own createCheckoutSession always stamps metadata.orderId; carrying it
    // by default keeps these ingestion tests on the "ours" path (a session with
    // no metadata.orderId is a foreign session — see the dedicated test below).
    metadataOrderId: "ord_x",
    ...overrides,
  };
}

async function orderFor(sessionId: string) {
  const [row] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.stripeCheckoutSessionId, sessionId));
  return row;
}

async function ledgerCount(eventId: string) {
  const rows = await db
    .select()
    .from(processedStripeEvent)
    .where(eq(processedStripeEvent.eventId, eventId));
  return rows.length;
}

beforeEach(async () => {
  await db.delete(processedStripeEvent);
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
});

describe("processStoreStripeEvent", () => {
  it("(a) no matching order → retryable + empty ledger; redelivery after the order appears applies", async () => {
    const first = await processStoreStripeEvent(db, msg(), STAGING);
    expect(first).toEqual<ProcessStripeEventResult>({ ok: false, outcome: "retryable" });
    expect(await ledgerCount("evt_x")).toBe(0);

    // The order finally exists — the same event now applies (no permanent loss).
    await seedOrder("cs_x");
    const second = await processStoreStripeEvent(db, msg(), STAGING);
    expect(second).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
    const order = await orderFor("cs_x");
    expect(order?.paymentStatus).toBe("paid");
    expect(order?.status).toBe("paid");
    expect(await ledgerCount("evt_x")).toBe(1);
  });

  it("(b) happy path: applied, order paid, one ledger row", async () => {
    await seedOrder("cs_x");
    const r = await processStoreStripeEvent(db, msg(), STAGING);
    expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
    expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");
    expect(await ledgerCount("evt_x")).toBe(1);
  });

  it("(c) duplicate: second call is 'duplicate', order still paid, one ledger row", async () => {
    await seedOrder("cs_x");
    await processStoreStripeEvent(db, msg(), STAGING);
    const second = await processStoreStripeEvent(db, msg(), STAGING);
    expect(second).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "duplicate" });
    expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");
    expect(await ledgerCount("evt_x")).toBe(1);
  });

  it("(d) unhandled type and missing objectId are 'ignored' with NO ledger row; unhandled reprocesses", async () => {
    await seedOrder("cs_x");

    const unhandled = await processStoreStripeEvent(
      db,
      msg({ id: "evt_pi", type: "payment_intent.succeeded", objectId: "pi_1" }),
      STAGING,
    );
    expect(unhandled).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
    expect(await ledgerCount("evt_pi")).toBe(0);

    const missingId = await processStoreStripeEvent(
      db,
      msg({ id: "evt_noid", objectId: undefined }),
      STAGING,
    );
    expect(missingId).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
    expect(await ledgerCount("evt_noid")).toBe(0);

    // Order was never touched by either ignored event.
    expect((await orderFor("cs_x"))?.paymentStatus).toBe("unpaid");

    // An unhandled type is NOT dedup-skipped: reprocessing runs the same path
    // again (a future handler could then act on the redelivery).
    const again = await processStoreStripeEvent(
      db,
      msg({ id: "evt_pi", type: "payment_intent.succeeded", objectId: "pi_1" }),
      STAGING,
    );
    expect(again).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
  });

  it("(d2) foreign checkout session (no metadata.orderId, no matching order) → ignored, no ledger row", async () => {
    // A payment link / Dashboard checkout in the same Stripe account: no order
    // carries the session id. Without the classification this would be
    // retryable and pollute the DLQ.
    const foreign = await processStoreStripeEvent(
      db,
      msg({ id: "evt_foreign", objectId: "cs_foreign", metadataOrderId: undefined }),
      STAGING,
    );
    expect(foreign).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
    expect(await ledgerCount("evt_foreign")).toBe(0);
  });

  it("(d3) missing metadata.orderId but the session id matches an order → applied", async () => {
    // Session-id matching is authoritative — a thin/truncated event payload
    // that dropped metadata must not strand a real order's event.
    await seedOrder("cs_x");

    const r = await processStoreStripeEvent(
      db,
      msg({ id: "evt_thin", metadataOrderId: undefined }),
      STAGING,
    );
    expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
    expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");
  });

  it("(d4) metadata.orderId present, no session match, order already cancelled → ignored (moot)", async () => {
    // The checkout reverse path cancelled the order before a session id was
    // attached; the session's later event is moot, not DLQ noise.
    await seedOrder("cs_never_attached");
    await db
      .update(customerOrder)
      .set({ status: "cancelled", stripeCheckoutSessionId: null })
      .where(eq(customerOrder.stripeCheckoutSessionId, "cs_never_attached"));

    const r = await processStoreStripeEvent(
      db,
      msg({ id: "evt_moot", objectId: "cs_orphaned", metadataOrderId: "o-cs_never_attached" }),
      STAGING,
    );
    expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
    expect(await ledgerCount("evt_moot")).toBe(0);
  });

  describe("(e) f07 livemode gate", () => {
    it("production + test-mode event → ignored, order untouched, deduped ledger row", async () => {
      await seedOrder("cs_x");
      const first = await processStoreStripeEvent(db, msg({ livemode: false }), PRODUCTION);
      expect(first).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "ignored" });
      expect((await orderFor("cs_x"))?.paymentStatus).toBe("unpaid");
      expect(await ledgerCount("evt_x")).toBe(1);

      // Redelivery of the permanently-inapplicable event stays one ledger row.
      await processStoreStripeEvent(db, msg({ livemode: false }), PRODUCTION);
      expect(await ledgerCount("evt_x")).toBe(1);
    });

    it("production + live event → applied", async () => {
      await seedOrder("cs_x");
      const r = await processStoreStripeEvent(db, msg({ livemode: true }), PRODUCTION);
      expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
      expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");
    });

    it("staging + test-mode event → applied", async () => {
      await seedOrder("cs_x");
      const r = await processStoreStripeEvent(db, msg({ livemode: false }), STAGING);
      expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
    });
  });

  describe("(f) f04 async payment lifecycle + out-of-order guard", () => {
    it("completed(unpaid) → processing, then async_payment_succeeded → paid", async () => {
      await seedOrder("cs_x");

      const completed = await processStoreStripeEvent(
        db,
        msg({ id: "evt_c", payment_status: "unpaid" }),
        STAGING,
      );
      expect(completed).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
      let order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("processing");
      expect(order?.status).toBe("pending"); // no 'processing' member in ORDER_STATUSES

      const succeeded = await processStoreStripeEvent(
        db,
        msg({ id: "evt_s", type: "checkout.session.async_payment_succeeded" }),
        STAGING,
      );
      expect(succeeded).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
      order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("paid");
      expect(order?.status).toBe("paid");
    });

    it("an async terminal state processed BEFORE completed is not clobbered back to processing", async () => {
      await seedOrder("cs_x");

      // Terminal 'paid' arrives first (queue reordering / retries).
      await processStoreStripeEvent(
        db,
        msg({ id: "evt_s", type: "checkout.session.async_payment_succeeded" }),
        STAGING,
      );
      expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");

      // The late completed(unpaid) must NOT drag it back to 'processing'.
      const completed = await processStoreStripeEvent(
        db,
        msg({ id: "evt_c", payment_status: "unpaid" }),
        STAGING,
      );
      expect(completed.ok).toBe(true);
      expect((await orderFor("cs_x"))?.paymentStatus).toBe("paid");
    });

    it("async_payment_failed → paymentStatus failed, status cancelled; late completed does not clobber", async () => {
      await seedOrder("cs_x");

      await processStoreStripeEvent(
        db,
        msg({ id: "evt_f", type: "checkout.session.async_payment_failed" }),
        STAGING,
      );
      let order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("failed");
      expect(order?.status).toBe("cancelled");

      await processStoreStripeEvent(db, msg({ id: "evt_c", payment_status: "unpaid" }), STAGING);
      order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("failed"); // terminal, not clobbered
      expect(order?.status).toBe("cancelled");
    });
  });

  describe("(g) terminal non-payment outcomes release reserved stock (Track D4/F, INV-5)", () => {
    it("expired → paymentStatus expired, status cancelled, stock released to pre-reservation value", async () => {
      // Reserved 2 of a variant that started at 10 → current stock 8.
      await seedReservedOrder("cs_exp", { variantId: "v1", quantity: 2, stock: 8 });

      const r = await processStoreStripeEvent(
        db,
        msg({
          id: "evt_exp",
          type: "checkout.session.expired",
          objectId: "cs_exp",
          payment_status: "unpaid",
        }),
        STAGING,
      );
      expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });

      const order = await orderFor("cs_exp");
      expect(order?.paymentStatus).toBe("expired");
      expect(order?.status).toBe("cancelled");
      expect(await stockOf("v1")).toBe(10); // 8 + 2 released
      expect(await ledgerCount("evt_exp")).toBe(1);
    });

    it("async_payment_failed → paymentStatus failed, status cancelled, stock released", async () => {
      // An async method arrives 'processing' before it declines.
      await seedReservedOrder("cs_fail", {
        variantId: "v2",
        quantity: 3,
        stock: 5,
        paymentStatus: "processing",
      });

      const r = await processStoreStripeEvent(
        db,
        msg({ id: "evt_fail", type: "checkout.session.async_payment_failed", objectId: "cs_fail" }),
        STAGING,
      );
      expect(r).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });

      const order = await orderFor("cs_fail");
      expect(order?.paymentStatus).toBe("failed");
      expect(order?.status).toBe("cancelled");
      expect(await stockOf("v2")).toBe(8); // 5 + 3 released
    });

    it("redelivered expired does NOT double-increment stock (idempotent release, INV-5)", async () => {
      await seedReservedOrder("cs_dup", { variantId: "v3", quantity: 2, stock: 8 });

      const expired = () =>
        msg({
          id: "evt_dup",
          type: "checkout.session.expired",
          objectId: "cs_dup",
          payment_status: "unpaid",
        });
      const first = await processStoreStripeEvent(db, expired(), STAGING);
      expect(first).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "applied" });
      expect(await stockOf("v3")).toBe(10);

      const second = await processStoreStripeEvent(db, expired(), STAGING);
      expect(second).toEqual<ProcessStripeEventResult>({ ok: true, outcome: "duplicate" });
      expect(await stockOf("v3")).toBe(10); // NOT 12 — released exactly once
      expect(await ledgerCount("evt_dup")).toBe(1);
    });

    it("out-of-order expired arriving after paid touches neither stock nor status", async () => {
      // The order already settled paid (stock stays reserved-as-sold).
      await seedReservedOrder("cs_paid", {
        variantId: "v4",
        quantity: 2,
        stock: 8,
        status: "paid",
        paymentStatus: "paid",
      });

      const r = await processStoreStripeEvent(
        db,
        msg({
          id: "evt_late",
          type: "checkout.session.expired",
          objectId: "cs_paid",
          payment_status: "unpaid",
        }),
        STAGING,
      );
      // The order exists, so the event is acked (recorded), not retried…
      expect(r.ok).toBe(true);

      const order = await orderFor("cs_paid");
      expect(order?.paymentStatus).toBe("paid"); // terminal, not clobbered
      expect(order?.status).toBe("paid");
      expect(await stockOf("v4")).toBe(8); // never released
    });

    it("a real expired event for an already-superseded order does NOT re-release stock (Track G3 convergence, INV-5)", async () => {
      // createCheckoutSession's supersede sweep already expired the session at
      // Stripe and released+cancelled this order (paymentStatus 'expired', status
      // 'cancelled', its 2 units handed back → stock already at 10). The real
      // checkout.session.expired webhook that Stripe fires afterward must no-op
      // through the same unpaid/processing gates the supersede release used.
      await seedReservedOrder("cs_super", {
        variantId: "v5",
        quantity: 2,
        stock: 10,
        status: "cancelled",
        paymentStatus: "expired",
      });

      const r = await processStoreStripeEvent(
        db,
        msg({
          id: "evt_super",
          type: "checkout.session.expired",
          objectId: "cs_super",
          payment_status: "unpaid",
        }),
        STAGING,
      );
      // The order exists, so the event is acked (recorded), not retried…
      expect(r.ok).toBe(true);

      const order = await orderFor("cs_super");
      expect(order?.paymentStatus).toBe("expired"); // unchanged
      expect(order?.status).toBe("cancelled"); // unchanged
      expect(await stockOf("v5")).toBe(10); // NOT 12 — released exactly once
    });
  });
});
