import { eq, sql } from "drizzle-orm";
import { customerOrder, orderItem, processedStripeEvent, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";
import { runBatch, type DbBatchItem } from "@/lib/db-batch";
import type { StoreStripeEventMessage } from "@/lib/stripe-webhook";

export type ProcessStripeEventResult =
  | { ok: true; outcome: "applied" | "duplicate" | "ignored" }
  | { ok: false; outcome: "retryable" };

// A single guarded stock-release UPDATE for the order matched by `objectId`.
// Re-increments every `product_variant` by the quantity its `order_item` row
// snapshotted (reserved and sold are the same decrement, so the release amount
// is exactly what was reserved). Two guards make the release idempotent and
// terminal-safe, both evaluated against table state BEFORE this event's own
// writes: `not exists` a ledger row for this event (a redelivery never
// double-releases) AND the order still `unpaid`/`processing` (a paid order's
// stock is never handed back). Both hold because this statement runs FIRST in
// the batch — before the order-status UPDATE and the ledger insert (Track D4).
// `meta.changes` here is the count of variant rows moved, NOT an
// order-existence probe (that stays the order-status UPDATE's job).
function releaseStockStatement(db: Db, objectId: string, eventId: string) {
  return db
    .update(productVariant)
    .set({
      stock: sql`${productVariant.stock} + (select coalesce(sum(${orderItem.quantity}), 0) from ${orderItem} inner join ${customerOrder} on ${customerOrder.id} = ${orderItem.orderId} where ${customerOrder.stripeCheckoutSessionId} = ${objectId} and ${orderItem.variantId} = ${productVariant.id})`,
    })
    .where(
      sql`${productVariant.id} in (select ${orderItem.variantId} from ${orderItem} inner join ${customerOrder} on ${customerOrder.id} = ${orderItem.orderId} where ${customerOrder.stripeCheckoutSessionId} = ${objectId}) and not exists (select 1 from ${processedStripeEvent} where ${processedStripeEvent.eventId} = ${eventId}) and exists (select 1 from ${customerOrder} where ${customerOrder.stripeCheckoutSessionId} = ${objectId} and ${customerOrder.paymentStatus} in ('unpaid', 'processing'))`,
    );
}

// The order UPDATE(s) a Stripe checkout-session event maps to, or `null` when
// the event isn't one we act on (unrecognized type, no session id, or a
// non-"payment" mode). The `switch` IS the allowlist: recognition and dispatch
// are the same code path, so they can't drift, and an unrecognized/ID-less
// event records NO ledger row (a future handler can still reprocess a Stripe
// redelivery; ledger growth stays bounded).
//
// Statements are returned in batch order: any stock-release UPDATE FIRST, then
// the order-status UPDATE (Track D4). The order-status UPDATE matches on
// stripeCheckoutSessionId ALONE, so its `meta.changes` reliably reports whether
// a matching order exists. The payment-state guards live in CASE expressions
// (evaluated against the row's pre-update values) so an out-of-order terminal
// state ('paid'/'failed'/'expired') is never clobbered back to 'processing',
// and a fulfilled order ('shipped'/'delivered') is never regressed.
// ORDER_STATUSES has no 'processing'/'failed'/'expired' member, so `status`
// stays 'pending' (or moves to 'cancelled' on a terminal non-payment outcome)
// — only paymentStatus (free-text) carries the granular Stripe lifecycle.
function buildEventMutations(
  db: Db,
  message: StoreStripeEventMessage,
): { objectId: string; statements: DbBatchItem[] } | null {
  const objectId = message.objectId;
  if (!objectId) return null;
  // Defense-in-depth: a "payment" mode is expected; a subscription-mode session
  // routed here by an endpoint misconfiguration is ignored, never mutated.
  if (message.mode !== undefined && message.mode !== "payment") return null;
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
      return {
        objectId,
        statements: [
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
        ],
      };
    }
    case "checkout.session.async_payment_succeeded":
      return {
        objectId,
        statements: [
          db
            .update(customerOrder)
            .set({
              paymentStatus: "paid",
              status: sql`case when ${customerOrder.status} = 'pending' then 'paid' else ${customerOrder.status} end`,
              updatedAt: now,
            })
            .where(where),
        ],
      };
    case "checkout.session.async_payment_failed":
      // A declined async method terminates the attempt: release the reserved
      // stock and cancel the order (both CASE/guard-gated so an out-of-order
      // 'paid' is never regressed), giving the buyer a clean state to retry
      // from (a new cart → new order, Track F2/D4).
      return {
        objectId,
        statements: [
          releaseStockStatement(db, objectId, message.id),
          db
            .update(customerOrder)
            .set({
              paymentStatus: sql`case when ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'failed' else ${customerOrder.paymentStatus} end`,
              status: sql`case when ${customerOrder.status} = 'pending' and ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'cancelled' else ${customerOrder.status} end`,
              updatedAt: now,
            })
            .where(where),
        ],
      };
    case "checkout.session.expired":
      // The buyer never completed an unpaid/processing session before its
      // expires_at window closed: release the reserved stock and cancel the
      // order (Track F1/D4).
      return {
        objectId,
        statements: [
          releaseStockStatement(db, objectId, message.id),
          db
            .update(customerOrder)
            .set({
              paymentStatus: sql`case when ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'expired' else ${customerOrder.paymentStatus} end`,
              status: sql`case when ${customerOrder.status} = 'pending' and ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'cancelled' else ${customerOrder.status} end`,
              updatedAt: now,
            })
            .where(where),
        ],
      };
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

  // Atomic: the order/stock UPDATE(s) and the EXISTS-gated ledger insert commit
  // together. The ledger row is written ONLY when a matching order exists, so a
  // no-match event records nothing and a later redelivery (once checkout-session
  // creation lands and the order carries the id) still applies. The ledger
  // insert runs LAST — a stock-release UPDATE guards on `not exists` its own
  // ledger row, so writing that row before the release runs would break release
  // idempotency (Track D4). `meta.changes` classifies the outcome with no extra
  // round-trip: any statement but the last (release + order-status) whose WHERE
  // matches the order contributes to `orderChanges` (a release only fires when
  // the order exists, so it never falsely signals a match the order-status
  // UPDATE didn't already), and the last statement's changes is `ledgerChanges`.
  const { objectId, statements } = mutations;
  const ledgerInsert = db
    .insert(processedStripeEvent)
    .select(
      sql`select ${message.id}, ${message.type}, ${Date.now()} where exists (select 1 from ${customerOrder} where ${customerOrder.stripeCheckoutSessionId} = ${objectId})`,
    )
    .onConflictDoNothing();

  const results = await runBatch(db, [...statements, ledgerInsert]);
  const ledgerChanges = results[results.length - 1]?.meta?.changes ?? 0;
  const orderChanges = results.slice(0, -1).reduce((sum, r) => sum + (r?.meta?.changes ?? 0), 0);

  if (orderChanges === 0) {
    // No order carries this session id. An event without `metadata.orderId`
    // was not created by this app (payment link, Dashboard checkout, another
    // integration) — classify it out instead of retrying it into the DLQ as
    // noise. An event WITH the field whose order is already terminal is moot
    // (the checkout reverse path cancelled it before attaching the session id).
    // Everything else is the order-creation-vs-webhook race: retry.
    if (message.metadataOrderId === undefined) {
      return { ok: true, outcome: "ignored" };
    }
    const [order] = await db
      .select({ status: customerOrder.status })
      .from(customerOrder)
      .where(eq(customerOrder.id, message.metadataOrderId))
      .limit(1);
    if (order && order.status === "cancelled") {
      return { ok: true, outcome: "ignored" };
    }
    return { ok: false, outcome: "retryable" };
  }
  if (ledgerChanges === 1) {
    return { ok: true, outcome: "applied" };
  }
  // Order present, ledger already had the event: the idempotent UPDATE re-ran
  // harmlessly.
  return { ok: true, outcome: "duplicate" };
}
