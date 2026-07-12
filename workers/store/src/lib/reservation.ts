// Shared stock-reservation helper. Reserving stock is a SQL-guarded conditional
// UPDATE (`stock = stock - qty WHERE id = :id AND stock >= :qty`), whose
// `meta.changes` (0 or 1) is the only trustworthy signal a line actually
// reserved — a JS-computed `Math.max(0, stock - qty)` write off a stale SELECT
// lets two concurrent requests both "succeed" against the last unit (oversell).
// D1's `db.batch` has no cross-statement abort (a zero-row UPDATE is not an
// error), so on any failed guard the caller must compensate explicitly. Shared
// by createCheckoutSession and placeOrder so both paths contend for the same
// `product_variant.stock` pool safely.
import { eq, sql } from "drizzle-orm";
import { orderItem, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { OrderLine } from "@/lib/pricing";

export type ReserveResult = { ok: true } | { ok: false; error: "out_of_stock"; message: string };

/**
 * Reserve stock for every priced line atomically. Runs one guarded
 * `UPDATE … WHERE stock >= quantity` per line inside a single `db.batch`, then
 * inspects each statement's `meta.changes`. If any line's guard matched no row
 * (a concurrent request won the last unit, or the variant vanished), the lines
 * that DID decrement are re-incremented in a compensating batch and the call
 * returns `out_of_stock` with the first failing line's title+size.
 *
 * Non-idempotent — each call decrements. Callers own not invoking it twice for
 * the same intent.
 */
export async function reserveStock(db: Db, lines: readonly OrderLine[]): Promise<ReserveResult> {
  if (lines.length === 0) return { ok: true };

  const guards = lines.map((line) =>
    db
      .update(productVariant)
      .set({ stock: sql`${productVariant.stock} - ${line.quantity}` })
      .where(
        sql`${productVariant.id} = ${line.variantId} and ${productVariant.stock} >= ${line.quantity}`,
      ),
  );
  const results = (await db.batch(guards as never)) as Array<{ meta?: { changes?: number } }>;

  const succeeded: OrderLine[] = [];
  let firstFailing: OrderLine | undefined;
  results.forEach((r, i) => {
    if ((r?.meta?.changes ?? 0) === 1) succeeded.push(lines[i]!);
    else if (!firstFailing) firstFailing = lines[i];
  });

  if (!firstFailing) return { ok: true };

  // Compensate: re-increment only the lines that actually decremented.
  if (succeeded.length > 0) {
    const compensations = succeeded.map((line) =>
      db
        .update(productVariant)
        .set({ stock: sql`${productVariant.stock} + ${line.quantity}` })
        .where(eq(productVariant.id, line.variantId)),
    );
    await db.batch(compensations as never);
  }

  return {
    ok: false,
    error: "out_of_stock",
    message: `${firstFailing.title} (${firstFailing.size})`,
  };
}

/**
 * Release the stock a reservation held, reading the release amounts from the
 * order's `order_item` rows (reserved and sold are the same decrement, so the
 * release amount is always exactly what was decremented). Used by the webhook
 * consumer and the reconciliation cron — never by createCheckoutSession's own
 * failure path, which uses reserveStock's cheaper in-request compensation.
 */
export async function releaseStock(db: Db, orderId: string): Promise<void> {
  const items = await db
    .select({ variantId: orderItem.variantId, quantity: orderItem.quantity })
    .from(orderItem)
    .where(eq(orderItem.orderId, orderId));
  if (items.length === 0) return;

  const increments = items.map((it) =>
    db
      .update(productVariant)
      .set({ stock: sql`${productVariant.stock} + ${it.quantity}` })
      .where(eq(productVariant.id, it.variantId)),
  );
  await db.batch(increments as never);
}
