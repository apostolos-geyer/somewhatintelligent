import { eq, sql } from "drizzle-orm";
import { customerOrder } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { StoreStripeEventMessage } from "@/lib/stripe-webhook";

export async function processStoreStripeEvent(db: Db, message: StoreStripeEventMessage) {
  const inserted = await db.run(sql`
    INSERT OR IGNORE INTO processed_stripe_event (event_id, event_type, processed_at)
    VALUES (${message.id}, ${message.type}, ${Date.now()})
  `);

  if ((inserted.meta.changes ?? 0) === 0) {
    return { ok: true as const, duplicate: true as const };
  }

  if (message.type === "checkout.session.completed" && message.objectId) {
    await db
      .update(customerOrder)
      .set({ paymentStatus: "paid", status: "paid", updatedAt: new Date() })
      .where(eq(customerOrder.stripeCheckoutSessionId, message.objectId));
  }

  return { ok: true as const, duplicate: false as const };
}
