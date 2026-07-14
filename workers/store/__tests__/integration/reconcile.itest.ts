/**
 * D1 integration (real local D1 via miniflare): the reconciliation sweep
 * (reconcilePendingReservations, Track D5/D6). Orphan detection (D1 state alone)
 * and stale-attached release (gated on a mocked sessions.retrieve) only prove
 * out against a real DB, so this runs in the pool tier (`bun run test:pool`),
 * mirroring stripe-events.itest.ts / checkout-session.itest.ts. The Stripe
 * re-check is injected, so no Stripe client is constructed here.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import {
  reconcilePendingReservations,
  type RetrievedSession,
  type SessionExpirer,
  type SessionRetriever,
} from "@/lib/reconcile";

const { product, productVariant, customerOrder, orderItem, deadStripeEvent } = schema;
const db = drizzle(env.DB, { schema });

const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);
const MIN = 60 * 1000;

// Seed a product + variant plus one order (with an order_item line) whose
// reserved stock the sweep can hand back. `stock` is the CURRENT (post-
// reservation) value; releasing `quantity` restores `stock + quantity`.
async function seedReservation(opts: {
  orderId: string;
  variantId: string;
  quantity: number;
  stock: number;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeSessionExpiresAt?: Date | null;
  status?: "pending" | "cancelled" | "paid";
  paymentStatus?: string;
  createdAt: Date;
}) {
  const now = new Date(NOW);
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
  await db.insert(customerOrder).values({
    id: opts.orderId,
    orderNumber: `SI-${opts.orderId}`,
    userId: "buyer-1",
    email: "buyer@example.com",
    status: opts.status ?? "pending",
    paymentStatus: opts.paymentStatus ?? "unpaid",
    shipName: "Ada",
    shipLine1: "1 Main",
    shipCity: "Toronto",
    shipRegion: "ON",
    shipPostal: "M5V",
    subtotalCents: 1500 * opts.quantity,
    totalCents: 1500 * opts.quantity,
    stripeCustomerId: opts.stripeCustomerId ?? null,
    stripeCheckoutSessionId: opts.stripeCheckoutSessionId ?? null,
    stripeSessionExpiresAt: opts.stripeSessionExpiresAt ?? null,
    createdAt: opts.createdAt,
    updatedAt: opts.createdAt,
  });
  await db.insert(orderItem).values({
    id: `oi-${opts.orderId}`,
    orderId: opts.orderId,
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

async function orderRow(orderId: string) {
  const [row] = await db.select().from(customerOrder).where(eq(customerOrder.id, orderId));
  return row!;
}

// Seed a dead_stripe_event row (unresolved) for a session id — evidence a DLQ
// arrival left behind that the sweep should stamp resolved once it acts.
async function seedDeadEvent(eventId: string, objectId: string) {
  const now = new Date(NOW);
  await db.insert(deadStripeEvent).values({
    eventId,
    eventType: "checkout.session.completed",
    objectId,
    metadataOrderId: null,
    payload: JSON.stringify({ id: eventId, objectId }),
    attempts: 6,
    reason: "retryable_exhausted",
    firstSeenAt: now,
    lastSeenAt: now,
  });
}

async function deadEventRow(eventId: string) {
  const [row] = await db.select().from(deadStripeEvent).where(eq(deadStripeEvent.eventId, eventId));
  return row;
}

// A retriever that returns a fixed session per id and records the ids it saw.
function retriever(map: Record<string, RetrievedSession>): SessionRetriever {
  return vi.fn(async (sessionId: string) => {
    const s = map[sessionId];
    if (!s) throw new Error(`unexpected retrieve for ${sessionId}`);
    return s;
  });
}

const expireOk = (): SessionExpirer => vi.fn(async () => {});

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
  await db.delete(deadStripeEvent);
});

describe("reconcilePendingReservations — orphans", () => {
  it("releases an orphan past the grace window (D1 state alone, no Stripe call)", async () => {
    await seedReservation({
      orderId: "o-orphan",
      variantId: "v1",
      quantity: 3,
      stock: 7, // reserved 10 → 7
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: null,
      createdAt: new Date(NOW - 20 * MIN),
    });

    const retrieveSession = retriever({});
    const result = await reconcilePendingReservations({
      db,
      retrieveSession,
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.orphansReleased).toBe(1);
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(await stockOf("v1")).toBe(10);
    const o = await orderRow("o-orphan");
    expect(o).toMatchObject({ status: "cancelled", paymentStatus: "expired" });
  });

  it("leaves an orphan still inside the grace window untouched", async () => {
    await seedReservation({
      orderId: "o-fresh-orphan",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: null,
      createdAt: new Date(NOW - 2 * MIN),
    });

    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({}),
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.orphansReleased).toBe(0);
    expect(await stockOf("v1")).toBe(7);
    expect((await orderRow("o-fresh-orphan")).status).toBe("pending");
  });

  it("never touches a manual placeOrder order (stripeCustomerId IS NULL)", async () => {
    await seedReservation({
      orderId: "o-manual",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: null, // placeOrder never sets it (INV-11 discriminator)
      stripeCheckoutSessionId: null,
      createdAt: new Date(NOW - 60 * MIN),
    });

    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({}),
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.orphansReleased).toBe(0);
    expect(await stockOf("v1")).toBe(7);
    expect((await orderRow("o-manual")).status).toBe("pending");
  });
});

describe("reconcilePendingReservations — stale-attached", () => {
  it("releases when the retrieved session is expired", async () => {
    await seedReservation({
      orderId: "o-stale-expired",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_expired",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      createdAt: new Date(NOW - 40 * MIN),
    });

    const retrieveSession = retriever({
      cs_expired: { status: "expired", payment_status: "unpaid" },
    });
    const result = await reconcilePendingReservations({
      db,
      retrieveSession,
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleReleased).toBe(1);
    expect(result.staleSkipped).toBe(0);
    expect(retrieveSession).toHaveBeenCalledWith("cs_expired");
    expect(await stockOf("v1")).toBe(10);
    expect(await orderRow("o-stale-expired")).toMatchObject({
      status: "cancelled",
      paymentStatus: "expired",
    });
  });

  it("expires then releases when the retrieved session is still open and unpaid (abandoned)", async () => {
    await seedReservation({
      orderId: "o-stale-open",
      variantId: "v1",
      quantity: 2,
      stock: 8,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_open",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      createdAt: new Date(NOW - 40 * MIN),
    });

    const expireSession = expireOk();
    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({ cs_open: { status: "open", payment_status: "unpaid" } }),
      expireSession,
      now: NOW,
    });

    expect(result.staleReleased).toBe(1);
    expect(expireSession).toHaveBeenCalledWith("cs_open");
    expect(await stockOf("v1")).toBe(10);
    expect((await orderRow("o-stale-open")).status).toBe("cancelled");
  });

  it("skips (no release) when expiring an open session throws — payment may have just landed", async () => {
    await seedReservation({
      orderId: "o-stale-open-racing",
      variantId: "v1",
      quantity: 2,
      stock: 8,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_racing",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      createdAt: new Date(NOW - 40 * MIN),
    });

    const expireSession: SessionExpirer = vi.fn(async () => {
      throw new Error("session is not open");
    });
    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({ cs_racing: { status: "open", payment_status: "unpaid" } }),
      expireSession,
      now: NOW,
    });

    expect(result.staleReleased).toBe(0);
    expect(result.staleSkipped).toBe(1);
    expect(await stockOf("v1")).toBe(8);
    expect((await orderRow("o-stale-open-racing")).status).toBe("pending");
  });

  it("does NOT release when the session is still processing (complete, async settling)", async () => {
    await seedReservation({
      orderId: "o-stale-processing",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_processing",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      status: "pending",
      paymentStatus: "processing",
      createdAt: new Date(NOW - 40 * MIN),
    });

    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({
        cs_processing: { status: "complete", payment_status: "unpaid" },
      }),
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleReleased).toBe(0);
    expect(result.staleSkipped).toBe(1);
    // Stock and order state untouched — the webhook still owns this order.
    expect(await stockOf("v1")).toBe(7);
    expect(await orderRow("o-stale-processing")).toMatchObject({
      status: "pending",
      paymentStatus: "processing",
    });
  });

  it("HEALS a stale session Stripe reports complete+paid → order paid, stock untouched, dead-letter resolved", async () => {
    // The completed-webhook was lost or drained to the DLQ: the buyer was
    // charged but the order is still pending/unpaid. The cron is the
    // authoritative money backstop — it must flip the order to paid.
    await seedReservation({
      orderId: "o-stale-paid",
      variantId: "v1",
      quantity: 3,
      stock: 7, // reserved 10 → 7; healing must NOT hand stock back (INV-3)
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_healme",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      status: "pending",
      paymentStatus: "unpaid",
      createdAt: new Date(NOW - 40 * MIN),
    });
    // A dead-letter row this session's lost webhook left behind.
    await seedDeadEvent("evt_lost", "cs_healme");

    const retrieveSession = retriever({
      cs_healme: { status: "complete", payment_status: "paid" },
    });
    const result = await reconcilePendingReservations({
      db,
      retrieveSession,
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleHealed).toBe(1);
    expect(result.staleReleased).toBe(0);
    expect(result.staleSkipped).toBe(0);
    expect(await stockOf("v1")).toBe(7); // stock moved once, at reservation
    expect(await orderRow("o-stale-paid")).toMatchObject({
      status: "paid",
      paymentStatus: "paid",
    });
    // The dead-letter evidence is now resolved (the loop closed).
    expect((await deadEventRow("evt_lost"))?.resolvedAt).toEqual(new Date(NOW));
  });

  it("resolves the dead-letter row when a stale session is released (dead)", async () => {
    await seedReservation({
      orderId: "o-stale-dead",
      variantId: "v1",
      quantity: 2,
      stock: 8,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_dead",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      createdAt: new Date(NOW - 40 * MIN),
    });
    await seedDeadEvent("evt_dead", "cs_dead");

    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({ cs_dead: { status: "expired", payment_status: "unpaid" } }),
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleReleased).toBe(1);
    expect((await deadEventRow("evt_dead"))?.resolvedAt).toEqual(new Date(NOW));
  });

  it("leaves a fresh attached reservation (expiry in the future) untouched", async () => {
    await seedReservation({
      orderId: "o-fresh-attached",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_fresh",
      stripeSessionExpiresAt: new Date(NOW + 20 * MIN),
      createdAt: new Date(NOW - 2 * MIN),
    });

    const retrieveSession = retriever({});
    const result = await reconcilePendingReservations({
      db,
      retrieveSession,
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleReleased).toBe(0);
    expect(result.staleSkipped).toBe(0);
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(await stockOf("v1")).toBe(7);
    expect((await orderRow("o-fresh-attached")).status).toBe("pending");
  });

  it("never releases an already-paid attached order (terminal paymentStatus filtered out)", async () => {
    await seedReservation({
      orderId: "o-paid",
      variantId: "v1",
      quantity: 3,
      stock: 7,
      stripeCustomerId: "cus_1",
      stripeCheckoutSessionId: "cs_paid",
      stripeSessionExpiresAt: new Date(NOW - 5 * MIN),
      status: "paid",
      paymentStatus: "paid",
      createdAt: new Date(NOW - 40 * MIN),
    });

    const retrieveSession = retriever({});
    const result = await reconcilePendingReservations({
      db,
      retrieveSession,
      expireSession: expireOk(),
      now: NOW,
    });

    expect(result.staleReleased).toBe(0);
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(await stockOf("v1")).toBe(7);
    expect((await orderRow("o-paid")).status).toBe("paid");
  });
});
