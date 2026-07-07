/**
 * D1 integration (real local D1 via miniflare): the place-order write path.
 * The pool harness binds ONLY D1 — no guestlist/roadie RPC and no request
 * context — so we REPLAY the exact D1 batch placeOrder runs (order insert +
 * per-line item insert + stock decrement, all-or-nothing) against a real D1,
 * proving the DB shape supports the load-bearing invariants: atomic stock
 * decrement, order-item snapshotting, and totals persistence.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { computeOrderTotals } from "@/lib/pricing";

const { product, productVariant, customerOrder, orderItem } = schema;
const db = drizzle(env.DB, { schema });

async function seedProduct(opts: {
  id: string;
  slug: string;
  priceCents: number;
  status?: string;
}) {
  const now = new Date();
  await db.insert(product).values({
    id: opts.id,
    slug: opts.slug,
    title: `Tee ${opts.id}`,
    priceCents: opts.priceCents,
    status: (opts.status ?? "active") as "active",
    createdBy: "admin",
    createdAt: now,
    updatedAt: now,
  });
}
async function seedVariant(opts: {
  id: string;
  productId: string;
  size: string;
  sku: string;
  stock: number;
}) {
  await db.insert(productVariant).values({ ...opts, createdAt: new Date() });
}

// Mirror placeOrder's batch construction against the real db.
async function placeOrderBatch(
  orderId: string,
  orderNumber: string,
  priced: Extract<ReturnType<typeof computeOrderTotals>, { ok: true }>,
  variantStock: Map<string, number>,
) {
  const now = new Date();
  const orderInsert = db.insert(customerOrder).values({
    id: orderId,
    orderNumber,
    userId: "buyer-1",
    email: "buyer@example.com",
    status: "pending",
    shipName: "Ada",
    shipLine1: "1 Main",
    shipCity: "Toronto",
    shipRegion: "ON",
    shipPostal: "M5V",
    subtotalCents: priced.subtotalCents,
    shippingCents: priced.shippingCents,
    totalCents: priced.totalCents,
    createdAt: now,
    updatedAt: now,
  });
  const lineStatements = priced.lines.flatMap((line, i) => [
    db.insert(orderItem).values({
      id: `${orderId}-item-${i}`,
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      titleSnapshot: line.title,
      sizeSnapshot: line.size,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    }),
    db
      .update(productVariant)
      .set({ stock: Math.max(0, (variantStock.get(line.variantId) ?? 0) - line.quantity) })
      .where(eq(productVariant.id, line.variantId)),
  ]);
  await db.batch([orderInsert, ...lineStatements] as never);
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
});

describe("placeOrder D1 write path", () => {
  it("decrements variant stock atomically and snapshots the line item", async () => {
    await seedProduct({ id: "p1", slug: "field-tee", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", sku: "FIELD-TEE-M", stock: 10 });

    const variants = await db.select().from(productVariant);
    const products = await db.select().from(product);
    const priced = computeOrderTotals([{ variantId: "v1", quantity: 3 }], variants, products);
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;

    await placeOrderBatch("o1", "SI-AAA111", priced, new Map(variants.map((v) => [v.id, v.stock])));

    // Stock decremented 10 → 7.
    const [v] = await db.select().from(productVariant).where(eq(productVariant.id, "v1"));
    expect(v!.stock).toBe(7);

    // Order-item snapshot persisted with the price/size taken at purchase.
    const items = await db.select().from(orderItem).where(eq(orderItem.orderId, "o1"));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      titleSnapshot: "Tee p1",
      sizeSnapshot: "M",
      unitPriceCents: 3000,
      quantity: 3,
    });

    // Totals persisted (subtotal 9000 clears the free-shipping threshold).
    const [order] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(order).toMatchObject({
      subtotalCents: 9000,
      shippingCents: 0,
      totalCents: 9000,
      status: "pending",
    });
  });

  it("snapshot survives a later catalog price edit (order history is immutable)", async () => {
    await seedProduct({ id: "p1", slug: "field-tee", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", sku: "FIELD-TEE-M", stock: 10 });
    const variants = await db.select().from(productVariant);
    const products = await db.select().from(product);
    const priced = computeOrderTotals([{ variantId: "v1", quantity: 1 }], variants, products);
    if (!priced.ok) throw new Error("priced");
    await placeOrderBatch("o1", "SI-AAA222", priced, new Map(variants.map((v) => [v.id, v.stock])));

    // Admin raises the price afterwards.
    await db.update(product).set({ priceCents: 9999 }).where(eq(product.id, "p1"));

    const [item] = await db.select().from(orderItem).where(eq(orderItem.orderId, "o1"));
    expect(item!.unitPriceCents).toBe(3000); // frozen at purchase
  });

  it("admin status transitions persist: pending → paid → shipped → delivered", async () => {
    await seedProduct({ id: "p1", slug: "s", priceCents: 1000 });
    await db.insert(customerOrder).values({
      id: "o1",
      orderNumber: "SI-BBB111",
      userId: "buyer-1",
      email: "b@e.com",
      status: "pending",
      shipName: "A",
      shipLine1: "1",
      shipCity: "T",
      shipRegion: "ON",
      shipPostal: "M",
      subtotalCents: 1000,
      totalCents: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db.update(customerOrder).set({ status: "paid" }).where(eq(customerOrder.id, "o1"));
    await db
      .update(customerOrder)
      .set({
        status: "shipped",
        carrier: "canadapost",
        trackingNumber: "TRK1",
        shippedAt: new Date(),
      })
      .where(eq(customerOrder.id, "o1"));
    await db
      .update(customerOrder)
      .set({ status: "delivered", deliveredAt: new Date() })
      .where(eq(customerOrder.id, "o1"));

    const [order] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(order!.status).toBe("delivered");
    expect(order!.carrier).toBe("canadapost");
    expect(order!.trackingNumber).toBe("TRK1");
    expect(order!.shippedAt).toBeInstanceOf(Date);
    expect(order!.deliveredAt).toBeInstanceOf(Date);
  });

  it("deleting an order cascades its line items", async () => {
    await seedProduct({ id: "p1", slug: "s", priceCents: 1000 });
    await db.insert(customerOrder).values({
      id: "o1",
      orderNumber: "SI-CCC111",
      userId: "u",
      email: "e",
      status: "pending",
      shipName: "A",
      shipLine1: "1",
      shipCity: "T",
      shipRegion: "ON",
      shipPostal: "M",
      subtotalCents: 1000,
      totalCents: 1000,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(orderItem).values({
      id: "i1",
      orderId: "o1",
      productId: "p1",
      variantId: "v1",
      titleSnapshot: "t",
      sizeSnapshot: "M",
      unitPriceCents: 1000,
      quantity: 1,
    });
    await db.delete(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(await db.select().from(orderItem).where(eq(orderItem.orderId, "o1"))).toEqual([]);
  });
});
