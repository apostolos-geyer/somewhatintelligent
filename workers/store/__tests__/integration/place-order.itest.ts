/**
 * D1 integration (real local D1 via miniflare): the place-order write path.
 * The pool harness binds ONLY D1 — no guestlist/roadie RPC and no request
 * context — so we REPLAY the exact D1 batch placeOrder runs (order insert +
 * per-line item insert + stock decrement, all-or-nothing) against a real D1,
 * proving the DB shape supports the load-bearing invariants: atomic stock
 * decrement, order-item snapshotting, and totals persistence.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { computeOrderTotals, loadPricingInputs } from "@/lib/pricing";
import { runBatch } from "@/lib/db-batch";
import { updateOrderShippingCore } from "@/lib/orders-core";
import { db, seedOrder, seedOrderItem, seedProduct, seedVariant } from "./helpers";

const { productBase, productRelease, productVariant, customerOrder, orderItem } = schema;

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
  await runBatch(db, [orderInsert, ...lineStatements]);
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(productBase); // cascades product_draft; `product` is a view
});

describe("placeOrder D1 write path", () => {
  it("decrements variant stock atomically and snapshots the line item", async () => {
    await seedProduct({ id: "p1", slug: "field-tee", priceCents: 3000 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", sku: "FIELD-TEE-M", stock: 10 });

    const { variants, products } = await loadPricingInputs(db, ["v1"]);
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
    const { variants, products } = await loadPricingInputs(db, ["v1"]);
    const priced = computeOrderTotals([{ variantId: "v1", quantity: 1 }], variants, products);
    if (!priced.ok) throw new Error("priced");
    await placeOrderBatch("o1", "SI-AAA222", priced, new Map(variants.map((v) => [v.id, v.stock])));

    // Admin raises the price afterwards by publishing a new active release and
    // advancing the pointer (releases are immutable — a price change is a new
    // release, not an in-place edit — INV-REL-1). Checkout would now charge the
    // new price, but the order_item snapshot is frozen at purchase and never
    // rewritten (INV-ORDER-1).
    await db.insert(productRelease).values({
      id: "rel-p1-v2",
      productId: "p1",
      version: "1.1.0",
      slug: "field-tee",
      title: "Field Tee",
      priceCents: 9999,
      publishedBySub: "admin",
      publishedAt: new Date(),
    });
    await db
      .update(productBase)
      .set({ activeReleaseId: "rel-p1-v2" })
      .where(eq(productBase.id, "p1"));

    const [item] = await db.select().from(orderItem).where(eq(orderItem.orderId, "o1"));
    expect(item!.unitPriceCents).toBe(3000); // frozen at purchase
  });

  it("admin status transitions persist: pending → paid → shipped → delivered", async () => {
    await seedProduct({ id: "p1", slug: "s", priceCents: 1000 });
    await seedOrder({
      id: "o1",
      orderNumber: "SI-BBB111",
      email: "b@e.com",
      shipName: "A",
      shipLine1: "1",
      shipCity: "T",
      shipPostal: "M",
      subtotalCents: 1000,
      totalCents: 1000,
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
    await seedOrder({
      id: "o1",
      orderNumber: "SI-CCC111",
      userId: "u",
      email: "e",
      shipName: "A",
      shipLine1: "1",
      shipCity: "T",
      shipPostal: "M",
      subtotalCents: 1000,
      totalCents: 1000,
    });
    await seedOrderItem({
      id: "i1",
      orderId: "o1",
      productId: "p1",
      variantId: "v1",
      unitPriceCents: 1000,
      quantity: 1,
    });
    await db.delete(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(await db.select().from(orderItem).where(eq(orderItem.orderId, "o1"))).toEqual([]);
  });
});

describe("updateOrderShippingCore", () => {
  const session = (id: string, role = "user"): PlatformSession =>
    ({ user: { id, email: `${id}@e.com`, role } }) as unknown as PlatformSession;

  const shipping = {
    name: "Grace Hopper",
    line1: "2 Navy Way",
    line2: "Suite 9",
    city: "Arlington",
    region: "VA",
    postal: "22201",
    phone: "+17035550100",
  };

  async function seedFor(status: schema.CustomerOrder["status"]) {
    await seedOrder({
      id: "o1",
      orderNumber: "SI-EDIT1",
      userId: "buyer-1",
      status,
      subtotalCents: 1000,
      totalCents: 1000,
    });
  }

  it("owner edits a pending order → ok, address written", async () => {
    await seedFor("pending");
    const res = await updateOrderShippingCore(db, session("buyer-1"), "SI-EDIT1", shipping);
    expect(res).toEqual({ ok: true });
    const [order] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(order).toMatchObject({
      shipName: "Grace Hopper",
      shipLine1: "2 Navy Way",
      shipLine2: "Suite 9",
      shipCity: "Arlington",
      shipRegion: "VA",
      shipPostal: "22201",
      shipCountry: "CA",
      shipPhone: "+17035550100",
    });
  });

  it("owner edits a paid (not-yet-shipped) order → ok", async () => {
    await seedFor("paid");
    expect(await updateOrderShippingCore(db, session("buyer-1"), "SI-EDIT1", shipping)).toEqual({
      ok: true,
    });
  });

  it("a shipped order is not_editable", async () => {
    await seedFor("shipped");
    const res = await updateOrderShippingCore(db, session("buyer-1"), "SI-EDIT1", shipping);
    expect(res).toEqual({ ok: false, error: "not_editable" });
    // Address untouched (still the seeded default).
    const [order] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(order!.shipName).toBe("Ada");
  });

  it("a non-owner non-admin is forbidden (throws)", async () => {
    await seedFor("pending");
    await expect(
      updateOrderShippingCore(db, session("stranger"), "SI-EDIT1", shipping),
    ).rejects.toThrow();
    const [order] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(order!.shipName).toBe("Ada"); // never written
  });

  it("an admin may edit another user's order", async () => {
    await seedFor("pending");
    expect(
      await updateOrderShippingCore(db, session("admin-1", "admin"), "SI-EDIT1", shipping),
    ).toEqual({ ok: true });
  });

  it("an unknown order number throws not-found", async () => {
    await expect(
      updateOrderShippingCore(db, session("buyer-1"), "SI-NOPE", shipping),
    ).rejects.toThrow();
  });
});
