// Reconciliation sweep (Track D5/D6) — the backstop for the two reservation
// failure classes no webhook can cover: (a) orphans — stock reserved but
// `sessions.create`/session-id-attach never completed (a crash inside the C1
// window), which have no live Stripe object to fire any event at; and (b)
// stale-attached — a session id was attached but its terminal webhook was lost
// or drained to the DLQ. Runs every `*/15 * * * *` (see worker.ts scheduled()),
// mirroring roadie's pendingReap cadence.
//
// The Stripe re-check is injected (SessionRetriever) so the D1 write path is
// drivable against a real DB in the pool tier with Stripe mocked. No Stripe
// import here — the client is constructed past the stripeConfigured gate in
// worker.ts and only its retrieve result (status + payment_status) is passed in.
import { and, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

import { customerOrder, deadStripeEvent, orderItem, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { DbBatchItem } from "@/lib/db-batch";
import { orderShippingBackfill, type StripeSessionSnapshot } from "@/lib/stripe-session-fields";

// An orphaned reservation is released on D1 state alone (Track D6) once it is
// older than this grace window — comfortably longer than any Stripe API round
// trip, so a reservation still mid-`sessions.create` is never swept.
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

// The subset of a retrieved Session the sweep branches on. `null` mirrors the
// SDK's own nullable fields; the snapshot fields carry the Stripe-collected
// address + finalized money a heal backfills onto the order.
export type RetrievedSession = {
  status: string | null;
  payment_status: string | null;
} & StripeSessionSnapshot;
export type SessionRetriever = (sessionId: string) => Promise<RetrievedSession>;

// Injected `stripe.checkout.sessions.expire`: only resolves on an OPEN session,
// so a resolved call proves the session can never be paid.
export type SessionExpirer = (sessionId: string) => Promise<void>;

export interface ReconcileDeps {
  db: Db;
  // Injected `stripe.checkout.sessions.retrieve` (status + payment_status only).
  retrieveSession: SessionRetriever;
  expireSession: SessionExpirer;
  // Overridable clock for tests; defaults to now.
  now?: number;
  // Overridable orphan grace window for tests; defaults to ORPHAN_GRACE_MS.
  graceMs?: number;
}

export interface ReconcileResult {
  orphansReleased: number;
  staleReleased: number;
  staleHealed: number;
  staleSkipped: number;
}

// Release the stock an order reserved and cancel it, in one batch. The stock
// UPDATE runs FIRST and the cancel UPDATE last (Track D4 ordering): the release
// guard reads `payment_status`, which the cancel would flip, so releasing before
// cancelling keeps the guard reading the pre-sweep state. Both statements are
// gated on the order still being `unpaid`/`processing`, so a webhook that landed
// between the candidate SELECT and this batch (moving the order to a terminal
// state) makes both guards no-op — the sweep never double-releases or clobbers a
// terminal state. Shared with createCheckoutSession's supersede path (Track G3),
// which releases a prior attempt Stripe has just confirmed expired.
export function releaseAndCancel(db: Db, orderId: string, now: Date): [DbBatchItem, DbBatchItem] {
  const release = db
    .update(productVariant)
    .set({
      stock: sql`${productVariant.stock} + (select coalesce(sum(${orderItem.quantity}), 0) from ${orderItem} where ${orderItem.orderId} = ${orderId} and ${orderItem.variantId} = ${productVariant.id})`,
    })
    .where(
      sql`${productVariant.id} in (select ${orderItem.variantId} from ${orderItem} where ${orderItem.orderId} = ${orderId}) and exists (select 1 from ${customerOrder} where ${customerOrder.id} = ${orderId} and ${customerOrder.paymentStatus} in ('unpaid', 'processing'))`,
    );
  const cancel = db
    .update(customerOrder)
    .set({
      paymentStatus: sql`case when ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'expired' else ${customerOrder.paymentStatus} end`,
      status: sql`case when ${customerOrder.status} = 'pending' and ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'cancelled' else ${customerOrder.status} end`,
      updatedAt: now,
    })
    .where(eq(customerOrder.id, orderId));
  return [release, cancel];
}

// Heal a paid order whose completed-webhook was lost or drained to the DLQ:
// advance it to the same terminal 'paid' state the consumer's
// `checkout.session.completed` success path would (paymentStatus + status),
// leaving stock untouched (INV-3 — stock moved once, at reservation). Both
// transitions are CASE-gated on the pre-sweep `unpaid`/`processing` state (and
// `status = 'pending'`) so a real webhook that lands between the candidate
// SELECT and this write, or a later real-event replay, is a harmless no-op. No
// ledger row is written — the state-gating alone makes replays idempotent. The
// Stripe-collected address + finalized totals are backfilled when the retrieved
// session carries them — this heal closes the paid-without-address hole.
function healPaid(db: Db, orderId: string, now: Date, snapshot: StripeSessionSnapshot) {
  return db
    .update(customerOrder)
    .set({
      paymentStatus: sql`case when ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'paid' else ${customerOrder.paymentStatus} end`,
      status: sql`case when ${customerOrder.status} = 'pending' and ${customerOrder.paymentStatus} in ('unpaid', 'processing') then 'paid' else ${customerOrder.status} end`,
      ...orderShippingBackfill(snapshot),
      updatedAt: now,
    })
    .where(eq(customerOrder.id, orderId));
}

// Once the cron heals or releases the order behind a session id, any
// dead_stripe_event rows for that session are no longer a live loss — stamp
// them resolved. The dead-letter table is visibility; the cron is the
// authority that closes the loop.
async function resolveDeadEvents(db: Db, sessionId: string, now: Date): Promise<void> {
  await db
    .update(deadStripeEvent)
    .set({ resolvedAt: now })
    .where(and(eq(deadStripeEvent.objectId, sessionId), isNull(deadStripeEvent.resolvedAt)));
}

/**
 * Sweep pending Stripe-path reservations and release the ones that can never
 * resolve on their own:
 *
 *   - Orphans (INV-6/INV-11): `stripeCheckoutSessionId IS NULL AND
 *     stripeCustomerId IS NOT NULL AND status='pending'` past the grace window.
 *     The `stripeCustomerId IS NOT NULL` discriminator keeps the sweep off
 *     manual `placeOrder` orders (which never set it). Released on D1 state alone
 *     — there is no live Stripe object to re-check.
 *   - Stale-attached (Track D6): a session id is attached, its
 *     `stripeSessionExpiresAt` has passed, and no terminal `paymentStatus`
 *     landed. Re-checked via `sessions.retrieve` first, then:
 *       - `complete` + paid/no_payment_required → HEALED to `paid` (the
 *         completed-webhook was lost or drained to the DLQ — the cron is the
 *         authoritative money backstop, not just a stock releaser).
 *       - expired, or still open-and-unpaid → released (dead session).
 *       - `complete` + still-unpaid (async settling) → left for its webhook.
 *     After a heal or release, any `dead_stripe_event` rows for that session
 *     are stamped resolved.
 */
export async function reconcilePendingReservations(deps: ReconcileDeps): Promise<ReconcileResult> {
  const { db, retrieveSession } = deps;
  const nowMs = deps.now ?? Date.now();
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - (deps.graceMs ?? ORPHAN_GRACE_MS));

  const orphans = await db
    .select({ id: customerOrder.id })
    .from(customerOrder)
    .where(
      and(
        isNull(customerOrder.stripeCheckoutSessionId),
        isNotNull(customerOrder.stripeCustomerId),
        eq(customerOrder.status, "pending"),
        lt(customerOrder.createdAt, cutoff),
      ),
    );

  // Rows are independent orders — sweep them concurrently; a failed row is
  // logged and left for the next run, never blocking its siblings.
  const orphanOutcomes = await Promise.all(
    orphans.map(async (row) => {
      try {
        await db.batch(releaseAndCancel(db, row.id, now));
      } catch (err) {
        console.warn(
          `[store] reconcile orphan release failed for ${row.id}: ${err instanceof Error ? err.message : "unknown"}`,
        );
        return false;
      }
      console.log("store.stripe_reservation.released", {
        order_id: row.id,
        reason: "cron_orphaned",
      });
      return true;
    }),
  );
  const orphansReleased = orphanOutcomes.filter(Boolean).length;

  const stale = await db
    .select({ id: customerOrder.id, sessionId: customerOrder.stripeCheckoutSessionId })
    .from(customerOrder)
    .where(
      and(
        isNotNull(customerOrder.stripeCheckoutSessionId),
        isNotNull(customerOrder.stripeSessionExpiresAt),
        lt(customerOrder.stripeSessionExpiresAt, now),
        eq(customerOrder.status, "pending"),
        inArray(customerOrder.paymentStatus, ["unpaid", "processing"]),
      ),
    );

  // Heal first: a `complete` session Stripe reports as settled means the buyer
  // was charged but the completed-webhook never landed (lost or drained to the
  // DLQ) — advance the order to `paid`; the cron is the authoritative backstop
  // for a captured charge. Release only a session PROVEN dead: already expired,
  // or open-and-unpaid and successfully expired here (a resolved expire is the
  // proof — the buyer can no longer pay it). Everything inconclusive — a failed
  // retrieve or expire (payment may have just landed), a `complete` session
  // still settling — is skipped for the next sweep, never released blind.
  const sweepOne = async (row: {
    id: string;
    sessionId: string | null;
  }): Promise<"released" | "healed" | "skipped"> => {
    const sessionId = row.sessionId;
    if (!sessionId) return "skipped";
    let session: RetrievedSession;
    try {
      session = await retrieveSession(sessionId);
    } catch (err) {
      console.warn(
        `[store] reconcile sessions.retrieve failed for ${sessionId}: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return "skipped";
    }
    const paid =
      session.status === "complete" &&
      (session.payment_status === "paid" || session.payment_status === "no_payment_required");
    if (paid) {
      await db.batch([healPaid(db, row.id, now, session)]);
      console.log("store.stripe_reconcile.healed_paid", {
        order_id: row.id,
        session_id: sessionId,
      });
      await resolveDeadEvents(db, sessionId, now);
      return "healed";
    }
    const dead =
      session.status === "expired" ||
      (session.status === "open" && session.payment_status === "unpaid");
    if (!dead) return "skipped";
    if (session.status === "open") {
      try {
        await deps.expireSession(sessionId);
      } catch {
        return "skipped";
      }
    }
    await db.batch(releaseAndCancel(db, row.id, now));
    console.log("store.stripe_reservation.released", {
      order_id: row.id,
      reason: "cron_stale_attached",
    });
    await resolveDeadEvents(db, sessionId, now);
    return "released";
  };

  // Independent orders, swept concurrently; a thrown row is skipped, not fatal.
  const staleOutcomes = await Promise.all(
    stale.map((row) =>
      sweepOne(row).catch((err: unknown) => {
        console.warn(
          `[store] reconcile stale sweep failed for ${row.id}: ${err instanceof Error ? err.message : "unknown"}`,
        );
        return "skipped" as const;
      }),
    ),
  );

  return {
    orphansReleased,
    staleReleased: staleOutcomes.filter((o) => o === "released").length,
    staleHealed: staleOutcomes.filter((o) => o === "healed").length,
    staleSkipped: staleOutcomes.filter((o) => o === "skipped").length,
  };
}
