/**
 * In-platform notification emitter — the PRIMARY delivery channel (the product
 * has "no email client"; a contact reply / fulfilment update / session reminder
 * reaches the budtender as a notifications row, surfaced in the Hub, P5.C).
 * Respects the granular per-user/per-brand/per-type `notification_prefs`
 * (default-on; an explicit `enabled = 0` row suppresses that type for that brand).
 *
 * An optional promoter EMAIL mirror is deferred: promoter's templates are
 * auth-specific today, so fulfilment/contact/booking email kinds are a separate
 * cross-service task (the PROMOTER binding is wired + typed for when they land).
 */
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { notificationPrefs, notifications } from "@/schema";

/** The CLOSED notification type enum (distinct from analytics_events.type). */
export type NotificationType =
  | "new_post"
  | "new_comment"
  | "chat"
  | "contact_reply"
  | "session_reminder"
  | "award"
  | "access_approved"
  | "fulfilment_status";

export interface NotificationInput {
  brandId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  refType?: string;
  refId?: string;
}

/** Emit one notification, honouring the recipient's per-type preference. */
export async function emitNotification(n: NotificationInput): Promise<void> {
  const db = createDb(env.DB);
  const pref = (
    await db
      .select({ enabled: notificationPrefs.enabled })
      .from(notificationPrefs)
      .where(
        and(
          eq(notificationPrefs.userId, n.userId),
          eq(notificationPrefs.brandId, n.brandId),
          eq(notificationPrefs.type, n.type),
        ),
      )
      .limit(1)
  ).at(0);
  if (pref && pref.enabled === 0) return; // explicit opt-out

  await db.insert(notifications).values({
    id: ulid(),
    brandId: n.brandId,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body ?? "",
    refType: n.refType ?? null,
    refId: n.refId ?? null,
    createdAt: Date.now(),
  });
}
