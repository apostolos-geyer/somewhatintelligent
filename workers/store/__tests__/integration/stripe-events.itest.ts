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

const { customerOrder, processedStripeEvent } = schema;
const db = drizzle(env.DB, { schema });

const STAGING = { ENVIRONMENT: "staging" } as const;
const PRODUCTION = { ENVIRONMENT: "production" } as const;

async function seedOrder(sessionId: string) {
  const now = new Date();
  await db.insert(customerOrder).values({
    id: `o-${sessionId}`,
    orderNumber: `SI-${sessionId}`,
    userId: "buyer-1",
    email: "buyer@example.com",
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

function msg(overrides: Partial<StoreStripeEventMessage> = {}): StoreStripeEventMessage {
  return {
    id: "evt_x",
    type: "checkout.session.completed",
    created: 0,
    livemode: false,
    objectId: "cs_x",
    payment_status: "paid",
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
  await db.delete(customerOrder);
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

    it("async_payment_failed → paymentStatus failed, status stays pending; late completed does not clobber", async () => {
      await seedOrder("cs_x");

      await processStoreStripeEvent(
        db,
        msg({ id: "evt_f", type: "checkout.session.async_payment_failed" }),
        STAGING,
      );
      let order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("failed");
      expect(order?.status).toBe("pending");

      await processStoreStripeEvent(db, msg({ id: "evt_c", payment_status: "unpaid" }), STAGING);
      order = await orderFor("cs_x");
      expect(order?.paymentStatus).toBe("failed"); // terminal, not clobbered
    });
  });
});
