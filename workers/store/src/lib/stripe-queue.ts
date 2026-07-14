import { deadStripeEvent } from "@/db/schema";
import { processStoreStripeEvent } from "@/lib/stripe-events";
import type { Db } from "@/lib/db";
import type { StoreStripeEventMessage } from "@/lib/stripe-webhook";

// Dead-letter queues are named `<queue>-dlq-<env>` (see wrangler.jsonc). One
// regex routes both staging + production DLQ batches to the terminal path.
export const DLQ_QUEUE_PATTERN = /-dlq-/;

/**
 * Main-queue consumer: fan out over the batch so one message's outcome (or
 * throw) can't hold up or fail its siblings. Per-message ack/retry isolates a
 * poison message; concurrent dispatch overlaps the D1 round-trips.
 *
 * `Promise.all` (not `allSettled`): the inner try/catch already prevents any
 * mapped promise from rejecting, so there is nothing for `allSettled` to
 * absorb. Only a thrown (transient) error or an explicit `{ ok: false }`
 * retryable outcome retries — applied/duplicate/ignored all ack.
 *
 * Retries carry an escalating `delaySeconds` (30s × attempts, capped at 5min)
 * so a transient D1 outage widens the redelivery window across the 5 retries
 * from seconds to ~20+ minutes — a blip longer than a minute no longer burns
 * straight to the DLQ. The DLQ still absorbs a permanently-unmatched event
 * (no order carries the session id), where it becomes durable evidence.
 */
export async function consumeStripeEventBatch(
  db: Db,
  batch: MessageBatch<StoreStripeEventMessage>,
  env: Pick<Env, "ENVIRONMENT">,
): Promise<void> {
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        const result = await processStoreStripeEvent(db, message.body, env);
        if (result.ok) {
          message.ack();
        } else {
          message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
        }
      } catch (err) {
        console.error("store.stripe_event.process_failed", {
          messageId: message.id,
          attempts: message.attempts,
          eventId: message.body?.id,
          eventType: message.body?.type,
          error: err instanceof Error ? err.message : String(err),
        });
        message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      }
    }),
  );
}

// Escalating backoff: 30s on the first retry, +30s each subsequent attempt,
// capped at Queues' 5-minute (300s) per-message ceiling.
function retryDelaySeconds(attempts: number): number {
  return Math.min(30 * attempts, 300);
}

/**
 * Terminal (dead-letter) consumer: nothing backs the DLQ, so a message is
 * ack'd after ONE best-effort reprocess — but only once its evidence is
 * durable. A DLQ arrival means the main queue exhausted its retries, so the
 * money invariant (a captured charge never silently vanishes) hinges on this
 * ack leaving a trail:
 *
 *   - reprocess → applied/duplicate/ignored: the event recovered (a transient
 *     blip cleared, or the order finally exists). Ack; log a one-line recovery
 *     note for `applied`.
 *   - reprocess → retryable (no matching order — the dominant DLQ cause) OR a
 *     throw: upsert the compacted payload into `dead_stripe_event`, log
 *     `stripe_dlq_event_dead`, then ack. The ack is unconditional as before
 *     (nothing backs the DLQ), but the evidence lands BEFORE the ack.
 *
 * The one case this terminal consumer retries: the dead-letter INSERT itself
 * throws (D1 down). Then the evidence never landed, so acking would lose it —
 * log `stripe_dlq_persist_failed` and retry with backoff; the DLQ consumer's
 * own max_retries (wrangler.jsonc) backs the redelivery.
 */
export async function processDlqBatch(
  db: Db,
  batch: MessageBatch<StoreStripeEventMessage>,
  env: Pick<Env, "ENVIRONMENT">,
): Promise<void> {
  for (const message of batch.messages) {
    let reason: "retryable_exhausted" | "reprocess_threw";
    let reprocessError: string | undefined;
    try {
      const result = await processStoreStripeEvent(db, message.body, env);
      if (result.ok) {
        if (result.outcome === "applied") {
          console.log("stripe_dlq_event_recovered", {
            messageId: message.id,
            eventId: message.body?.id,
            eventType: message.body?.type,
            objectId: message.body?.objectId,
            queue: batch.queue,
          });
        }
        message.ack();
        continue;
      }
      reason = "retryable_exhausted";
    } catch (err) {
      reason = "reprocess_threw";
      reprocessError = err instanceof Error ? err.message : String(err);
    }

    // Persist forensics BEFORE the ack. If this write fails, do NOT ack —
    // retry so the DLQ redelivery retries the persistence (the sole retry case).
    try {
      const now = new Date();
      await db
        .insert(deadStripeEvent)
        .values({
          eventId: message.body.id,
          eventType: message.body.type,
          objectId: message.body.objectId ?? null,
          metadataOrderId: message.body.metadataOrderId ?? null,
          payload: JSON.stringify(message.body),
          attempts: message.attempts,
          reason,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: deadStripeEvent.eventId,
          set: { lastSeenAt: now, attempts: message.attempts, reason },
        });
    } catch (err) {
      console.error("stripe_dlq_persist_failed", {
        messageId: message.id,
        attempts: message.attempts,
        eventId: message.body?.id,
        eventType: message.body?.type,
        queue: batch.queue,
        reason,
        error: err instanceof Error ? err.message : String(err),
      });
      message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
      continue;
    }

    console.error("stripe_dlq_event_dead", {
      messageId: message.id,
      eventId: message.body?.id,
      eventType: message.body?.type,
      objectId: message.body?.objectId,
      reason,
      error: reprocessError,
      attempts: message.attempts,
      queue: batch.queue,
    });
    message.ack();
  }
}
