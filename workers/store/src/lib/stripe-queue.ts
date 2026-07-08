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
          message.retry();
        }
      } catch (err) {
        console.error("store.stripe_event.process_failed", {
          messageId: message.id,
          attempts: message.attempts,
          eventId: message.body?.id,
          eventType: message.body?.type,
          error: err instanceof Error ? err.message : String(err),
        });
        message.retry();
      }
    }),
  );
}

/**
 * Terminal (dead-letter) consumer: nothing backs the DLQ, so every message is
 * ack'd unconditionally after ONE best-effort reprocess (recovers events that
 * only failed on a transient D1 blip). A throw is logged for triage, never
 * retried — there is no further backstop.
 */
export async function processDlqBatch(
  db: Db,
  batch: MessageBatch<StoreStripeEventMessage>,
  env: Pick<Env, "ENVIRONMENT">,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processStoreStripeEvent(db, message.body, env);
    } catch (err) {
      console.error("stripe_dlq_reprocess_failed", {
        messageId: message.id,
        attempts: message.attempts,
        eventId: message.body?.id,
        eventType: message.body?.type,
        queue: batch.queue,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    message.ack();
  }
}
