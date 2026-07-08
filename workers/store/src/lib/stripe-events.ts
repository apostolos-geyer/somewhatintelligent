import { eq, sql } from "drizzle-orm";
import { customerOrder, processedStripeEvent } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { StoreStripeEventMessage } from "@/lib/stripe-webhook";

export type ProcessStripeEventResult =
  | { ok: true; outcome: "applied" | "duplicate" | "ignored" }
  | { ok: false; outcome: "retryable" };

// The order UPDATE(s) a Stripe checkout-session event maps to, or `null` when
// the event isn't one we act on (unrecognized type OR no session id). The
// `switch` IS the allowlist: recognition and dispatch are the same code path,
// so they can't drift, and an unrecognized/ID-less event records NO ledger row
// (a future handler can still reprocess a Stripe redelivery; ledger growth
// stays bounded).
//
// Every UPDATE matches on stripeCheckoutSessionId ALONE, so `meta.changes`
// reliably reports whether a matching order exists. The payment-state guards
// live in CASE expressions (evaluated against the row's pre-update values) so
// an out-of-order terminal state ('paid'/'failed') is never clobbered back to
// 'processing', and a fulfilled order ('shipped'/'delivered') is never regressed.
// ORDER_STATUSES has no 'processing'/'failed' member, so `status` stays
// 'pending' on those paths — only paymentStatus (free-text) carries them.
function buildEventMutations(db: Db, message: StoreStripeEventMessage) {
  const objectId = message.objectId;
  if (!objectId) return null;
  const now = new Date();
  const where = eq(customerOrder.stripeCheckoutSessionId, objectId);

  switch (message.type) {
    case "checkout.session.completed": {
      // A synchronous card session settles as "paid" immediately; an async
      // method (iDEAL/SEPA/…) arrives "unpaid" and settles later via
      // async_payment_*. Only advance from the default 'unpaid'.
      const settled =
        message.payment_status === "paid" || message.payment_status === "no_payment_required";
      const nextPay = settled ? "paid" : "processing";
      return [
        db
          .update(customerOrder)
          .set({
            paymentStatus: sql`case when ${customerOrder.paymentStatus} = 'unpaid' then ${nextPay} else ${customerOrder.paymentStatus} end`,
            ...(settled
              ? {
                  status: sql`case when ${customerOrder.status} = 'pending' and ${customerOrder.paymentStatus} = 'unpaid' then 'paid' else ${customerOrder.status} end`,
                }
              : {}),
            updatedAt: now,
          })
          .where(where),
      ];
    }
    case "checkout.session.async_payment_succeeded":
      return [
        db
          .update(customerOrder)
          .set({
            paymentStatus: "paid",
            status: sql`case when ${customerOrder.status} = 'pending' then 'paid' else ${customerOrder.status} end`,
            updatedAt: now,
          })
          .where(where),
      ];
    case "checkout.session.async_payment_failed":
      return [
        db.update(customerOrder).set({ paymentStatus: "failed", updatedAt: now }).where(where),
      ];
    default:
      return null;
  }
}

/**
 * Idempotent, atomic ingestion of one Stripe checkout-session event onto the
 * matching order. Returns a 4-way outcome the queue consumer maps to ack/retry:
 *
 *   - "ignored"   — nothing to do (unhandled type / no session id / wrong mode)
 *   - "applied"   — order mutated, first time this event was seen
 *   - "duplicate" — event already in the ledger; the idempotent UPDATE re-ran
 *   - retryable   — no order carries this session id yet (redeliver later)
 */
export async function processStoreStripeEvent(
  db: Db,
  message: StoreStripeEventMessage,
  env: Pick<Env, "ENVIRONMENT">,
): Promise<ProcessStripeEventResult> {
  const mutations = buildEventMutations(db, message);
  if (!mutations) {
    return { ok: true, outcome: "ignored" };
  }

  // Livemode gate: production acts only on live events, every other environment
  // only on test-mode ones (inverted form — any non-"production" value expects
  // livemode=false). A permanently-inapplicable wrong-mode event is recorded
  // (deduped) so redeliveries don't re-warn, but no order is touched.
  const expectedLivemode = env.ENVIRONMENT === "production";
  if (message.livemode !== expectedLivemode) {
    await db
      .insert(processedStripeEvent)
      .values({ eventId: message.id, eventType: message.type, processedAt: new Date() })
      .onConflictDoNothing();
    console.warn(
      `[store] stripe event ${message.id} (${message.type}) livemode=${message.livemode} does not match environment "${env.ENVIRONMENT}" (expected livemode=${expectedLivemode}); skipping mutation`,
    );
    return { ok: true, outcome: "ignored" };
  }

  // Atomic: the EXISTS-gated ledger insert and the order UPDATE(s) commit
  // together. The ledger row is written ONLY when a matching order exists, so a
  // no-match event records nothing and a later redelivery (once checkout-session
  // creation lands and the order carries the id) still applies. `meta.changes`
  // on both statements classifies the outcome with no extra round-trip.
  const objectId = message.objectId as string; // guaranteed by buildEventMutations
  const ledgerInsert = db
    .insert(processedStripeEvent)
    .select(
      sql`select ${message.id}, ${message.type}, ${Date.now()} where exists (select 1 from ${customerOrder} where ${customerOrder.stripeCheckoutSessionId} = ${objectId})`,
    )
    .onConflictDoNothing();

  const results = (await db.batch([ledgerInsert, ...mutations] as never)) as Array<{
    meta?: { changes?: number };
  }>;
  const ledgerChanges = results[0]?.meta?.changes ?? 0;
  const orderChanges = results.slice(1).reduce((sum, r) => sum + (r?.meta?.changes ?? 0), 0);

  if (orderChanges === 0) {
    // No order carries this session id (every real event today — checkout-
    // session creation is deferred). The EXISTS-gated ledger recorded nothing,
    // so a redelivery after the order appears still applies. The queue retries
    // and, permanently unmatched, drains to the DLQ rather than looping forever.
    return { ok: false, outcome: "retryable" };
  }
  if (ledgerChanges === 1) {
    return { ok: true, outcome: "applied" };
  }
  // Order present, ledger already had the event: the idempotent UPDATE re-ran
  // harmlessly.
  return { ok: true, outcome: "duplicate" };
}
