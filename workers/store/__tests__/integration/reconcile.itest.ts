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
  type SessionRetriever,
} from "@/lib/reconcile";

const { product, productVariant, customerOrder, orderItem } = schema;
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

// A retriever that returns a fixed session per id and records the ids it saw.
function retriever(map: Record<string, RetrievedSession>): SessionRetriever {
  return vi.fn(async (sessionId: string) => {
    const s = map[sessionId];
    if (!s) throw new Error(`unexpected retrieve for ${sessionId}`);
    return s;
  });
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
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
    const result = await reconcilePendingReservations({ db, retrieveSession, now: NOW });

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
    const result = await reconcilePendingReservations({ db, retrieveSession, now: NOW });

    expect(result.staleReleased).toBe(1);
    expect(result.staleSkipped).toBe(0);
    expect(retrieveSession).toHaveBeenCalledWith("cs_expired");
    expect(await stockOf("v1")).toBe(10);
    expect(await orderRow("o-stale-expired")).toMatchObject({
      status: "cancelled",
      paymentStatus: "expired",
    });
  });

  it("releases when the retrieved session is still open and unpaid (abandoned)", async () => {
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

    const result = await reconcilePendingReservations({
      db,
      retrieveSession: retriever({ cs_open: { status: "open", payment_status: "unpaid" } }),
      now: NOW,
    });

    expect(result.staleReleased).toBe(1);
    expect(await stockOf("v1")).toBe(10);
    expect((await orderRow("o-stale-open")).status).toBe("cancelled");
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
    const result = await reconcilePendingReservations({ db, retrieveSession, now: NOW });

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
    const result = await reconcilePendingReservations({ db, retrieveSession, now: NOW });

    expect(result.staleReleased).toBe(0);
    expect(retrieveSession).not.toHaveBeenCalled();
    expect(await stockOf("v1")).toBe(7);
    expect((await orderRow("o-paid")).status).toBe("paid");
  });
});
