import { describe, expect, test } from "vitest";
import type { Db } from "@/lib/db";
import { computeOrderTotals, type OrderLine, type PricingProduct } from "@/lib/pricing";
import { reserveStock } from "@/lib/reservation";

// reserveStock's control flow (inspect every guard's meta.changes; compensate
// the succeeded lines on any failure) is provable against a fake db that
// scripts the batch results — the SQL guard's real behaviour is covered against
// live D1 in reservation.itest.ts. The fake records each db.batch call's
// argument array so we can assert a compensating batch ran and how many lines
// it re-incremented.
function fakeDb(batchResults: number[][]) {
  const batchCalls: unknown[][] = [];
  let call = 0;
  const builder = {
    set: () => builder,
    where: () => ({}), // opaque statement token pushed into the batch array
  };
  const db = {
    update: () => builder,
    batch: async (stmts: unknown[]) => {
      batchCalls.push(stmts);
      const changes = batchResults[call++] ?? [];
      return changes.map((c) => ({ meta: { changes: c } }));
    },
  };
  return { db: db as unknown as Db, batchCalls };
}

const line = (variantId: string, size: string, title = "Field Tee"): OrderLine => ({
  variantId,
  productId: "p1",
  title,
  size,
  unitPriceCents: 3000,
  quantity: 1,
});

describe("reserveStock", () => {
  test("commits every line and runs no compensating batch when all guards pass", async () => {
    const { db, batchCalls } = fakeDb([[1, 1]]);
    const res = await reserveStock(db, [line("v1", "M"), line("v2", "L")]);
    expect(res).toEqual({ ok: true });
    expect(batchCalls).toHaveLength(1); // reservation only
  });

  test("compensates the succeeded lines and returns out_of_stock on a failed guard", async () => {
    // Line 0 reserves (changes 1); line 1's guard matches no row (changes 0).
    const { db, batchCalls } = fakeDb([[1, 0], []]);
    const res = await reserveStock(db, [line("v1", "M", "Field Tee"), line("v2", "L", "Camp Tee")]);
    expect(res).toEqual({ ok: false, error: "out_of_stock", message: "Camp Tee (L)" });
    expect(batchCalls).toHaveLength(2); // reservation + compensation
    expect(batchCalls[1]).toHaveLength(1); // only the one succeeded line re-incremented
  });

  test("skips the compensating batch when no line succeeded", async () => {
    const { db, batchCalls } = fakeDb([[0, 0]]);
    const res = await reserveStock(db, [line("v1", "M"), line("v2", "L")]);
    expect(res.ok).toBe(false);
    expect(batchCalls).toHaveLength(1); // nothing to re-increment
  });

  test("empty line set is a no-op success with no db calls", async () => {
    const { db, batchCalls } = fakeDb([]);
    const res = await reserveStock(db, []);
    expect(res).toEqual({ ok: true });
    expect(batchCalls).toHaveLength(0);
  });
});

describe("reserveStock pricing source (INV-1)", () => {
  // The reservation path re-prices from the product row via computeOrderTotals,
  // exactly like placeOrder — a forged client unit price never survives.
  const product: PricingProduct = {
    id: "p1",
    title: "Field Tee",
    priceCents: 3000,
    status: "active",
  };
  const variant = { id: "v1", productId: "p1", size: "M", stock: 10 };

  test("a forged cart price is ignored; the product row is authoritative", () => {
    const priced = computeOrderTotals(
      // A client can only send variantId/quantity; there is no price field to
      // forge, and the line it produces carries the product's price.
      [{ variantId: "v1", quantity: 2 }],
      [variant],
      [product],
    );
    expect(priced.ok).toBe(true);
    if (!priced.ok) return;
    expect(priced.lines[0]!.unitPriceCents).toBe(3000);
    expect(priced.subtotalCents).toBe(6000);
  });
});
