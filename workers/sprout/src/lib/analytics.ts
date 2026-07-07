/**
 * Append-only engagement event writer (INV: no code path UPDATEs/DELETEs
 * analytics_events — it's the immutable source of truth dashboards + CSV read).
 * D1 is authoritative; Analytics Engine (AE) is an optional sampled mirror for
 * the two high-rate types only (deck_flip dwell, session join duration) and is
 * never read by a product surface (D-ANALYTICS-SINK-SPLIT) — wired in P6.
 *
 * Callers that also keep a denormalized counter (banner impressions/clicks, asset
 * downloads) bump that counter in the SAME logical write as the event row.
 */
import { env } from "cloudflare:workers";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { analyticsEvents } from "@/schema";

/** The closed analytics event-type vocabulary (02 §12). */
export type AnalyticsEventType =
  | "deck_open"
  | "deck_flip"
  | "deck_download"
  | "product_view"
  | "review_left"
  | "quiz_attempt_start"
  | "quiz_attempt_submit"
  | "cert_awarded"
  | "asset_download"
  | "physical_request"
  | "ai_question"
  | "post_view"
  | "post_like"
  | "comment_create"
  | "chat_message"
  | "session_register"
  | "session_join"
  | "booking_created"
  | "banner_impression"
  | "banner_click";

export interface AnalyticsEvent {
  brandId: string;
  actorId: string;
  type: AnalyticsEventType;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function emitEvent(e: AnalyticsEvent): Promise<void> {
  const db = createDb(env.DB);
  await db.insert(analyticsEvents).values({
    id: ulid(),
    brandId: e.brandId,
    actorId: e.actorId,
    type: e.type,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    metadataJson: JSON.stringify(e.metadata ?? {}),
    createdAt: Date.now(),
  });
}
