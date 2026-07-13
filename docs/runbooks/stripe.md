# Stripe DLQ, dead-letter forensics & the money invariant

Everything an operator needs when a Stripe checkout event does not resolve
cleanly: what lands in the dead-letter queue, where the durable evidence lives,
and how to replay or heal a stuck order. Code lives in
`workers/store/src/lib/{stripe-queue,stripe-events,reconcile}.ts`; the pipeline
overview is `docs/ARCHITECTURE.md` §7.

---

## The money invariant

> **A captured charge always terminates as a paid order or a deliberate refund —
> never silently neither.**

The pipeline is at-least-once on both edges (Stripe and Cloudflare Queues), so
the guarantee is not "every webhook applies on the first try" — it is "no
captured charge is ever lost." Four mechanisms uphold it, each with a distinct
job:

| Mechanism                              | Role          | What it guarantees                                                                                                                    |
| -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Reconcile cron healer (`reconcile.ts`) | authority     | A stale-attached session Stripe reports `complete` + paid is flipped to a `paid` order even if its webhook was lost or dead-lettered. |
| `dead_stripe_event` table              | visibility    | A non-recovered DLQ event is durable and queryable, so a stuck payment surfaces instead of ageing out of the queue.                   |
| Escalating retry backoff               | prevention    | A transient D1 outage no longer burns 5 retries in seconds — the redelivery window widens to ~20+ minutes, so most blips self-heal.   |
| Foreign-session metadata guard         | signal purity | Sessions that are not ours (no `metadata.orderId`) are classified `ignored`, not retried into the DLQ as noise.                       |

The cron healer is the load-bearing one: even if the dead-letter table were
empty, a paid-but-unfulfilled order is picked up by the next `*/15` sweep.

---

## DLQ taxonomy — cases & handling

A message reaches the DLQ (`si-stripe-events-dlq-<env>`) after 5 backed-off
main-queue retries. `processDlqBatch` reprocesses it once, then acts by case:

| Case                               | Cause                                                                                           | DLQ outcome                                                                            | Terminal handling                                                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **A. Sustained transient failure** | D1 unavailable longer than the widened retry window.                                            | reprocess throws → `dead_stripe_event` (`reprocess_threw`)                             | Fix D1, then **replay** the event from the Stripe Dashboard (ledger dedups). Cron also heals if the order is paid. |
| **B. Deterministic bug / poison**  | A handler bug throws on this event every time.                                                  | reprocess throws → `dead_stripe_event` (`reprocess_threw`)                             | Fix the bug + deploy, then replay from Dashboard. The row stays unresolved until the order settles.                |
| **C. Crash-window orphan**         | Stock reserved but `sessions.create`/session-id-attach never completed (no live Stripe object). | never reaches this consumer — no session id, no webhook.                               | Cron orphan sweep releases it on D1 state alone after the 10-min grace window.                                     |
| **D. Foreign session**             | A payment link / Dashboard checkout / other integration in the same Stripe account.             | classified `ignored` at ingestion (no `metadata.orderId`) — **never** reaches the DLQ. | None needed. If one predates the metadata guard it would dead-letter once; safe to ignore/resolve.                 |
| **E. Duplicates / out-of-order**   | Stripe or Queues redelivery; a terminal event arriving before `completed`.                      | reprocess → applied/duplicate/ignored → **recovered**, acked.                          | None — the ledger (`processed_stripe_event`) + CASE-gated UPDATEs make replays idempotent.                         |
| **F. Subscription-mode**           | A subscription session routed here by endpoint misconfiguration.                                | classified `ignored` (mode ≠ `payment`) — never mutates an order.                      | Fix the webhook endpoint config. The `@better-auth/stripe` plugin owns subscriptions, not store.                   |

The dominant real case today is **A/B-shaped no-match**: until Checkout Session
creation ships, no order carries a `stripe_checkout_session_id`, so every real
event is `retryable`, exhausts retries, and dead-letters as `retryable_exhausted`.
That is forward-compatible — no ledger row is written until an order matches, so
a later replay applies cleanly.

`reason` values in `dead_stripe_event`:

- `retryable_exhausted` — reprocess still found no matching order (the order↔webhook race, or a genuinely orphaned event).
- `reprocess_threw` — reprocess raised (cases A/B).

---

## Querying `dead_stripe_event`

The table is store's D1 (`store-<env>-db`). Unresolved rows are the live loss
list:

```sh
# Local (miniflare D1)
cd workers/store && wrangler d1 execute DB --local \
  --command "select event_id, event_type, object_id, reason, attempts, first_seen_at, last_seen_at from dead_stripe_event where resolved_at is null order by last_seen_at desc;"

# Staging
cd workers/store && wrangler d1 execute DB --remote \
  --command "select event_id, event_type, object_id, metadata_order_id, reason, attempts from dead_stripe_event where resolved_at is null;"

# Production
cd workers/store && wrangler d1 execute DB --remote --env production \
  --command "select event_id, event_type, object_id, metadata_order_id, reason, attempts from dead_stripe_event where resolved_at is null;"
```

Log lines to grep in `wrangler tail`: `stripe_dlq_event_dead` (evidence
persisted), `stripe_dlq_event_recovered` (a DLQ arrival self-healed),
`stripe_dlq_persist_failed` (the dead-letter INSERT itself failed — the one case
the terminal consumer retries), `store.stripe_reconcile.healed_paid` (cron
healed a lost-webhook order).

A row's `object_id` is the checkout session id — join it against
`customer_order.stripe_checkout_session_id` to find the order.

---

## Replay procedure (Stripe Dashboard event resend)

Replaying is **safe** — the consumer is idempotent on `event.id`
(`processed_stripe_event` ledger) and the order UPDATEs are CASE-gated against
pre-update state, so a redelivered event that already applied is a harmless
no-op.

1. In the Stripe Dashboard, open **Developers → Events**, find the event by its
   `event_id` (the `dead_stripe_event.event_id`).
2. **Resend** it to the `/hooks/store` endpoint for that env.
3. It flows through the normal pipeline: verify → enqueue → consumer. If the
   underlying cause (D1 down, handler bug) is fixed and an order now matches, it
   applies; the ledger records it once.
4. The `dead_stripe_event` row is stamped `resolved_at` by the next reconcile
   sweep once the order reaches a terminal state (there is no separate manual
   resolve step — the cron closes the loop on `object_id` match).

---

## Running the reconcile sweep out-of-band

The sweep runs on cron `*/15 * * * *` (`worker.ts` `scheduled()`), gated behind
`stripeConfigured`. To force it between ticks, trigger the scheduled handler:

```sh
# Local dev — the miniflare scheduled trigger
cd workers/store && curl "http://localhost:$STORE_PORT/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"

# Staging / production — Cloudflare Dashboard → the store worker → Triggers →
# "Run" the */15 cron, or `wrangler` scheduled invocation against the deployed
# worker. Needs Stripe secrets present (else the handler early-returns).
```

What it does per stale-attached order (session id attached, past
`stripe_session_expires_at`, still `unpaid`/`processing`):

- `sessions.retrieve` reports `complete` + paid/no_payment_required → **heal**
  the order to `paid` (stock untouched — INV-3; no ledger row — state-gating
  makes a later real-event replay a no-op), log `store.stripe_reconcile.healed_paid`.
- `expired`, or `open` + `unpaid` → **release** the reserved stock and cancel.
- `complete` + still `unpaid` (async method settling) → **leave** for the webhook.

After a heal or release it stamps `resolved_at` on any matching
`dead_stripe_event` rows (`object_id` = session id). Orphans (no session id, past
the 10-min grace) are released on D1 state alone.
