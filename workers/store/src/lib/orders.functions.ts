// Order + fulfillment server functions.
//   • placeOrder / listMyOrders / getMyOrder — authenticated customer.
//   • listAllOrders / getOrderAdmin / fulfillOrder / setOrderStatus — admin.
// Payment is a manual stub for now (no gateway wired): a placed order starts
// "pending"; an admin marks it "paid", then ships it with a tracking number.
import { createServerFn } from "@tanstack/react-start";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { type } from "arktype";

import { customerOrder, orderItem, product, productVariant } from "@/db/schema";
import { getDb } from "@/lib/db";
import { ulid } from "@somewhatintelligent/kit/ids";
import { analyticsEvent } from "@/lib/middleware/analytics";
import {
  authMiddleware,
  requireAdminMiddleware,
  requireAuthMiddleware,
} from "@/lib/middleware/auth";
import { isAdminRole } from "@somewhatintelligent/kit/roles";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { CARRIER_KEYS } from "@/lib/config";
import { computeOrderTotals } from "@/lib/pricing";

// Cap admin order lists (query-hygiene §5 — no unbounded table scans).
const ORDER_LIST_LIMIT = 200;

function orderNumber(): string {
  return `SI-${ulid().slice(-6).toUpperCase()}`;
}

// ── Customer ─────────────────────────────────────────────────────────────────

const shippingSchema = type({
  name: "2 <= string <= 120",
  line1: "1 <= string <= 160",
  "line2?": "string <= 160",
  city: "1 <= string <= 80",
  region: "1 <= string <= 80",
  postal: "1 <= string <= 20",
  "country?": "string <= 2",
  "phone?": "string <= 40",
});

const placeOrderInput = type({
  items: type({ variantId: "string", quantity: "1 <= number.integer <= 99" })
    .array()
    .atLeastLength(1),
  shipping: shippingSchema,
});

export type PlaceOrderResult =
  | {
      ok: true;
      orderNumber: string;
      itemCount: number;
      subtotalCents: number;
      shippingCents: number;
      totalCents: number;
    }
  | { ok: false; error: string; message?: string };

export const placeOrder = createServerFn({ method: "POST" })
  // ONE line instruments the fn AND auth-gates it (analyticsEvent folds in requireAuthMiddleware).
  .middleware([
    analyticsEvent("order_placed", ({ result }) => {
      const r = result as PlaceOrderResult;
      if (!r.ok) return null; // priced-failure is a RETURN, not a throw → emit nothing
      return {
        properties: {
          order_number: r.orderNumber,
          item_count: r.itemCount,
          subtotal_cents: r.subtotalCents,
          shipping_cents: r.shippingCents,
          total_cents: r.totalCents,
        },
        group: true, // attach groups.organization when the session has an active org
      };
    }),
  ])
  .inputValidator((data: typeof placeOrderInput.infer) => placeOrderInput.assert(data))
  .handler(async ({ data, context }): Promise<PlaceOrderResult> => {
    const db = getDb();
    // The analyticsEvent seam composes requireAuthMiddleware but its
    // AnyFunctionMiddleware typing widens the handler's inferred data/context,
    // so re-narrow both here (the session cast mirrors the middleware's own).
    const input = data as typeof placeOrderInput.infer;
    const session = context.session as PlatformSession;
    const variantIds = input.items.map((i) => i.variantId);
    const variants = await db
      .select()
      .from(productVariant)
      .where(inArray(productVariant.id, variantIds));
    const productIds = [...new Set(variants.map((v) => v.productId))];
    const products = productIds.length
      ? await db.select().from(product).where(inArray(product.id, productIds))
      : [];

    // Pure pricing + stock validation (src/lib/pricing.ts). Price is taken from
    // the product row, never the client cart.
    const priced = computeOrderTotals(input.items, variants, products);
    if (!priced.ok) return priced;
    const { lines, subtotalCents: subtotal, shippingCents, totalCents: total } = priced;

    const variantById = new Map(variants.map((v) => [v.id, v]));
    const id = ulid();
    const num = orderNumber();
    const now = new Date();
    const s = input.shipping;

    const orderInsert = db.insert(customerOrder).values({
      id,
      orderNumber: num,
      userId: session.user.id,
      email: session.user.email ?? "",
      status: "pending",
      shipName: s.name,
      shipLine1: s.line1,
      shipLine2: s.line2 ?? null,
      shipCity: s.city,
      shipRegion: s.region,
      shipPostal: s.postal,
      shipCountry: s.country ?? "CA",
      shipPhone: s.phone ?? null,
      subtotalCents: subtotal,
      shippingCents,
      totalCents: total,
      createdAt: now,
      updatedAt: now,
    });
    const lineStatements = lines.flatMap((line) => {
      const v = variantById.get(line.variantId)!;
      return [
        db.insert(orderItem).values({
          id: ulid(),
          orderId: id,
          productId: line.productId,
          variantId: line.variantId,
          titleSnapshot: line.title,
          sizeSnapshot: line.size,
          unitPriceCents: line.unitPriceCents,
          quantity: line.quantity,
        }),
        // Decrement stock (best-effort; pre-checked above).
        db
          .update(productVariant)
          .set({ stock: Math.max(0, v.stock - line.quantity) })
          .where(eq(productVariant.id, line.variantId)),
      ];
    });
    // D1 batch — all-or-nothing.
    await db.batch([orderInsert, ...lineStatements]);

    return {
      ok: true,
      orderNumber: num,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      subtotalCents: subtotal,
      shippingCents,
      totalCents: total,
    };
  });

export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireAuthMiddleware])
  .handler(async ({ context }) => {
    const db = getDb();
    const orders = await db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.userId, context.session.user.id))
      .orderBy(desc(customerOrder.createdAt));
    return { orders };
  });

export const getMyOrder = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { orderNumber: string }) => type({ orderNumber: "string" }).assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [order] = await db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.orderNumber, data.orderNumber))
      .limit(1);
    if (!order) throw new NotFoundError();
    const isOwner = context.session?.user.id === order.userId;
    const isAdmin = isAdminRole(context.session?.user.role);
    if (!isOwner && !isAdmin) throw new ForbiddenError();
    const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
    return { order, items };
  });

// ── Admin ────────────────────────────────────────────────────────────────────

export const listAllOrders = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { status?: string }) => type({ "status?": "string" }).assert(data ?? {}))
  .handler(async ({ data }) => {
    const db = getDb();
    const q = db.select().from(customerOrder).$dynamic();
    if (data.status && data.status !== "all") {
      q.where(eq(customerOrder.status, data.status as never));
    }
    const orders = await q.orderBy(desc(customerOrder.createdAt)).limit(ORDER_LIST_LIMIT);
    return { orders };
  });

export const getOrderAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orderNumber: string }) => type({ orderNumber: "string" }).assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    const [order] = await db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.orderNumber, data.orderNumber))
      .limit(1);
    if (!order) throw new NotFoundError();
    const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
    return { order, items };
  });

const setStatusInput = type({
  orderNumber: "string",
  status: "'pending' | 'paid' | 'cancelled'",
});

export const setOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof setStatusInput.infer) => setStatusInput.assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    await db
      .update(customerOrder)
      .set({ status: data.status, updatedAt: new Date() })
      .where(eq(customerOrder.orderNumber, data.orderNumber));
    return { ok: true as const };
  });

const fulfillInput = type({
  orderNumber: "string",
  // Carrier keys come from the single CARRIERS source in lib/config.ts.
  carrier: type.enumerated(...CARRIER_KEYS),
  trackingNumber: "1 <= string <= 80",
  "note?": "string <= 500",
});

// Ship an order: attach carrier + tracking number, flip to "shipped", stamp
// shippedAt. The customer sees the tracking link on their order page. (Email
// notification is a Promoter-side template addition — see docs/apps/storefront.md.)
export const fulfillOrder = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof fulfillInput.infer) => fulfillInput.assert(data))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const db = getDb();
    const [order] = await db
      .select()
      .from(customerOrder)
      .where(eq(customerOrder.orderNumber, data.orderNumber))
      .limit(1);
    if (!order) throw new NotFoundError();
    if (order.status === "cancelled") return { ok: false, error: "order_cancelled" };
    await db
      .update(customerOrder)
      .set({
        status: "shipped",
        carrier: data.carrier,
        trackingNumber: data.trackingNumber,
        fulfillmentNote: data.note ?? null,
        shippedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customerOrder.id, order.id));
    return { ok: true };
  });

export const markDelivered = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orderNumber: string }) => type({ orderNumber: "string" }).assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    await db
      .update(customerOrder)
      .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(customerOrder.orderNumber, data.orderNumber));
    return { ok: true as const };
  });

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const db = getDb();
    // SQL aggregates instead of scanning whole tables into memory.
    const statusCount = (s: string) =>
      count(sql`case when ${customerOrder.status} = ${s} then 1 end`);
    const [orderAgg, productAgg] = await Promise.all([
      db
        .select({
          total: count(),
          awaitingPayment: statusCount("pending"),
          toShip: statusCount("paid"),
          shipped: statusCount("shipped"),
          revenueCents: sql<number>`coalesce(sum(case when ${customerOrder.status} not in ('pending', 'cancelled') then ${customerOrder.totalCents} else 0 end), 0)`,
        })
        .from(customerOrder),
      db
        .select({
          total: count(),
          active: count(sql`case when ${product.status} = 'active' then 1 end`),
        })
        .from(product),
    ]);
    return {
      totalProducts: productAgg[0]?.total ?? 0,
      activeProducts: productAgg[0]?.active ?? 0,
      totalOrders: orderAgg[0]?.total ?? 0,
      awaitingPayment: orderAgg[0]?.awaitingPayment ?? 0,
      toShip: orderAgg[0]?.toShip ?? 0,
      shipped: orderAgg[0]?.shipped ?? 0,
      revenueCents: orderAgg[0]?.revenueCents ?? 0,
    };
  });
