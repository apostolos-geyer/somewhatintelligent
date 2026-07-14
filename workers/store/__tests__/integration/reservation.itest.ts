/**
 * D1 integration (real local D1 via miniflare): the SQL-guarded stock
 * reservation. The oversell guard only holds against a real database — two
 * concurrent guarded UPDATEs on the last unit must serialize so exactly one
 * decrements — so this runs in the pool tier alongside place-order.itest.ts.
 */
import * as schema from "@/db/schema";
import type { OrderLine } from "@/lib/pricing";
import { reserveStock } from "@/lib/reservation";
import { db, seedProduct, seedVariant, stockOf } from "./helpers";

const { product, productVariant, customerOrder, orderItem } = schema;

const line = (variantId: string, quantity: number, over: Partial<OrderLine> = {}): OrderLine => ({
  variantId,
  productId: "p1",
  title: "Tee p1",
  size: "M",
  unitPriceCents: 3000,
  quantity,
  ...over,
});

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(product);
});

describe("reserveStock against real D1", () => {
  it("decrements each line's stock when every guard passes", async () => {
    await seedProduct({ id: "p1" });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });
    await seedVariant({ id: "v2", productId: "p1", size: "L", stock: 5 });

    const res = await reserveStock(db, [line("v1", 2), line("v2", 3, { size: "L" })]);
    expect(res).toEqual({ ok: true });
    expect(await stockOf("v1")).toBe(3);
    expect(await stockOf("v2")).toBe(2);
  });

  // INV-4: two concurrent reservations against the last unit — exactly one wins.
  it("never oversells: two concurrent reservations on stock:1 → exactly one succeeds", async () => {
    await seedProduct({ id: "p1" });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 1 });

    const [a, b] = await Promise.all([
      reserveStock(db, [line("v1", 1)]),
      reserveStock(db, [line("v1", 1)]),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok);
    expect(loser).toMatchObject({ ok: false, error: "out_of_stock", message: "Tee p1 (M)" });
    // The last unit went to exactly one winner; stock never goes negative.
    expect(await stockOf("v1")).toBe(0);
  });

  // Track D2: a failed guard mid-batch re-increments the lines that decremented.
  it("compensates: a partial reservation is fully reversed and stock is restored", async () => {
    await seedProduct({ id: "p1" });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 }); // enough
    await seedVariant({ id: "v2", productId: "p1", size: "L", stock: 1 }); // short for qty 2

    const res = await reserveStock(db, [line("v1", 2), line("v2", 2, { size: "L" })]);
    expect(res).toMatchObject({ ok: false, error: "out_of_stock" });
    // v1's decrement was rolled back; v2 never changed.
    expect(await stockOf("v1")).toBe(5);
    expect(await stockOf("v2")).toBe(1);
  });
});
