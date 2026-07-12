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

import { customerOrder, orderItem, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";

// An orphaned reservation is released on D1 state alone (Track D6) once it is
// older than this grace window — comfortably longer than any Stripe API round
// trip, so a reservation still mid-`sessions.create` is never swept.
const ORPHAN_GRACE_MS = 10 * 60 * 1000;

// The subset of a retrieved Session the sweep branches on. `null` mirrors the
// SDK's own nullable fields.
export type RetrievedSession = { status: string | null; payment_status: string | null };
export type SessionRetriever = (sessionId: string) => Promise<RetrievedSession>;

export interface ReconcileDeps {
  db: Db;
  // Injected `stripe.checkout.sessions.retrieve` (status + payment_status only).
  retrieveSession: SessionRetriever;
  // Overridable clock for tests; defaults to now.
  now?: number;
  // Overridable orphan grace window for tests; defaults to ORPHAN_GRACE_MS.
  graceMs?: number;
}

export interface ReconcileResult {
  orphansReleased: number;
  staleReleased: number;
  staleSkipped: number;
}

// Release the stock an order reserved and cancel it, in one batch. The stock
// UPDATE runs FIRST and the cancel UPDATE last (Track D4 ordering): the release
// guard reads `payment_status`, which the cancel would flip, so releasing before
// cancelling keeps the guard reading the pre-sweep state. Both statements are
// gated on the order still being `unpaid`/`processing`, so a webhook that landed
// between the candidate SELECT and this batch (moving the order to a terminal
// state) makes both guards no-op — the sweep never double-releases or clobbers a
// terminal state.
function releaseAndCancel(db: Db, orderId: string, now: Date) {
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
 *     landed. Re-checked via `sessions.retrieve` first and released ONLY if
 *     Stripe agrees the session is dead (expired, or still open-and-unpaid) —
 *     never a `complete` session, whose async payment method may still be
 *     settling and whose webhook owns the terminal transition.
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

  let orphansReleased = 0;
  for (const row of orphans) {
    await db.batch(releaseAndCancel(db, row.id, now) as never);
    orphansReleased++;
    console.log("store.stripe_reservation.released", { order_id: row.id, reason: "cron_orphaned" });
  }

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

  let staleReleased = 0;
  let staleSkipped = 0;
  for (const row of stale) {
    const sessionId = row.sessionId;
    if (!sessionId) continue;
    let session: RetrievedSession;
    try {
      session = await retrieveSession(sessionId);
    } catch (err) {
      // A failed re-check is inconclusive — never release blind. Leave the order
      // for the next sweep.
      staleSkipped++;
      console.warn(
        `[store] reconcile sessions.retrieve failed for ${sessionId}: ${err instanceof Error ? err.message : "unknown"}`,
      );
      continue;
    }
    // Release only a session Stripe agrees is dead: expired, or still
    // open-and-unpaid past its window (abandoned). A `complete` session — paid,
    // or an async method still settling — is left to its webhook.
    const dead =
      session.status === "expired" ||
      (session.status === "open" && session.payment_status === "unpaid");
    if (!dead) {
      staleSkipped++;
      continue;
    }
    await db.batch(releaseAndCancel(db, row.id, now) as never);
    staleReleased++;
    console.log("store.stripe_reservation.released", {
      order_id: row.id,
      reason: "cron_stale_attached",
    });
  }

  return { orphansReleased, staleReleased, staleSkipped };
}
