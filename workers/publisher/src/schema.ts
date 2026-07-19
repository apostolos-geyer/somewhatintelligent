import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Publisher D1 schema.
 *
 * SCAFFOLD (exec-plan 0004 track T14) — this file currently declares only the
 * shared audit table so the D1 binding, drizzle config, and migration pipeline
 * are wired end to end. The full model — `text_entry`/`text_release`,
 * `software_draft`/`software_publication`, `page_entry`/`page_release`, `tag`,
 * `link`, `media` + `media_gc_outbox`, and `operator_deletion_intent` — is
 * transcribed from RFC-0001 "Publisher D1" in track T14. Timestamps are unix
 * milliseconds, matching the rest of the platform.
 */

/**
 * Append-only operator audit log (RFC-0001 D13 / INV-AUDIT-1). One row per
 * successful operator mutation. `(idempotency_key, action)` is unique so a
 * replayed command returns the prior `response_json` instead of mutating twice
 * (INV-AUDIT-1). Sensitive bodies and secrets are never copied here.
 */
export const operatorEvent = sqliteTable(
  "operator_event",
  {
    id: text("id").primaryKey(),
    actorSub: text("actor_sub").notNull(),
    actorEmail: text("actor_email").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id"),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    responseJson: text("response_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("u_operator_event_key").on(t.idempotencyKey, t.action)],
);

export type OperatorEventRow = typeof operatorEvent.$inferSelect;
