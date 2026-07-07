/**
 * Hub notification system (P5.C) — the cross-brand feed + the granular per-brand,
 * per-type preferences. These server fns are PLATFORM-WIDE (the Hub renders at the
 * apex where there is no active brand), so they scope to the caller's OWN rows by
 * `user_id` from the verified envelope — NEVER `activeOrgId`, NEVER another user.
 *
 * Tenancy, by function:
 *  - `listNotifications` / `markRead` / `markAllRead` read+write the caller's own
 *    `notifications` rows (`user_id = caller`). `markRead` re-checks ownership in
 *    the WHERE clause, so a forged/foreign id is a no-op, never a leak. The brand
 *    NAME rides each feed row via a LEFT JOIN to `org_brand_directory` (the Hub
 *    feed mixes brands; the name + slug disambiguate + drive the cross-host
 *    deep-link).
 *  - `getNotificationPrefs` returns the caller's saved `notification_prefs` rows;
 *    the grid renders DEFAULT-ON, so an absent (brand,type) pair is `enabled`. There
 *    is NO global switch — prefs are granular only (product law).
 *  - `setNotificationPref` writes the pref for the VIEWED brand only. It gates on
 *    `requireBrandAudience`, which proves the caller is a portal-member OR
 *    org-member OR platform-admin of the viewed brand (this is what admits
 *    budtenders — portal_members rows, no org membership — that the old
 *    `getCallerOrgRole`-only check wrongly forbade). The upsert's `brand_id` is
 *    `context.brand.id` (the authorized viewed brand), NEVER the client-supplied
 *    `brandId`, so the input can't steer the write to a foreign brand; `user_id`
 *    is still the envelope's, never input.
 *
 * The CLOSED `NotificationType` enum (from `@/lib/notify`) drives the settings
 * grid; an unknown `type` from input is rejected by the arktype validator.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, isNull } from "drizzle-orm";
import { portalEntryUrl } from "@/lib/brand-resolution";
import { createDb } from "@/lib/db";
import { notificationPrefs, notifications, orgBrandDirectory } from "@/schema";
import { requireBrandAudience, requireUserMiddleware } from "@/lib/middleware/auth";
import type { NotificationType } from "@/lib/notify";

/**
 * The CLOSED notification-type enum, mirrored as a runtime array (the emitter's
 * `@/lib/notify` exports only the `NotificationType` union, and that module is
 * owned elsewhere). The `satisfies` clause pins this list to the canonical union
 * by value — adding a type to `notify.ts` without mirroring it here is a type
 * error, so the two can't silently drift. Drives the settings grid + the
 * defensive narrowing of D1's untyped `type` column.
 */
export const NOTIFICATION_TYPES = [
  "new_post",
  "new_comment",
  "chat",
  "contact_reply",
  "session_reminder",
  "award",
  "access_approved",
  "fulfilment_status",
] as const satisfies readonly NotificationType[];

// Exhaustiveness the other way: every `NotificationType` must appear above, so a
// type added to `notify.ts` (without mirroring) fails to compile here too.
type _AllTypesMirrored = NotificationType extends (typeof NOTIFICATION_TYPES)[number]
  ? true
  : never;
const _allTypesMirrored: _AllTypesMirrored = true;
void _allTypesMirrored;

/** One feed row as the Hub notification list renders it (newest-first). */
export interface NotificationView {
  id: string;
  brandId: string;
  /** Resolved from `org_brand_directory`; null for a not-yet-mirrored org. */
  brandName: string | null;
  /** The brand's host label, for the cross-host deep-link; null when unmirrored. */
  brandSlug: string | null;
  type: NotificationType;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  read: boolean;
  createdAt: number;
  /**
   * The cross-host destination this notification deep-links to — an absolute URL
   * at the brand's portal (`<slug>.<apex><path>`), derived SERVER-SIDE from the
   * directory slug + `refType` so the client never builds a foreign host. Null
   * when the brand isn't mirrored yet (the row still renders, just inert).
   */
  href: string | null;
}

/** The caller's saved pref for one (brand, type) pair. Absent ⇒ default-on. */
export interface NotificationPref {
  brandId: string;
  type: NotificationType;
  enabled: boolean;
}

// The typed (camelCase) projections Drizzle returns; mapped to the view at the edge.
interface NotificationRow {
  id: string;
  brandId: string;
  brandName: string | null;
  brandSlug: string | null;
  type: string;
  title: string;
  body: string;
  refType: string | null;
  refId: string | null;
  readAt: number | null;
  createdAt: number;
}

interface PrefRow {
  brandId: string;
  type: string;
  enabled: number;
}

/** Narrow an untrusted string column to the closed enum (drops anything else). */
function asNotificationType(v: string): NotificationType | null {
  return (NOTIFICATION_TYPES as readonly string[]).includes(v) ? (v as NotificationType) : null;
}

/**
 * Map a notification's `refType` to the in-portal PATH it deep-links to, mirroring
 * the established emit sites + the portal's `?section=` layer convention:
 *  - `physical_request` (fulfilment_status) → the budtender's `/requests` view,
 *  - `thread` (contact_reply)              → the Contact section layer,
 *  - everything else                       → the portal root.
 * The `new_post`/`new_comment`/`chat` types surface the relevant section even when
 * the emitter didn't stamp a refType (they map by `type`, handled by the caller).
 * Returns a path beginning with "/".
 */
function deepLinkPath(type: NotificationType, refType: string | null): string {
  if (refType === "physical_request") return "/requests";
  if (refType === "thread") return "/?section=contact";
  switch (type) {
    case "new_post":
    case "new_comment":
      return "/?section=feed";
    case "chat":
      return "/?section=chat";
    case "contact_reply":
      return "/?section=contact";
    case "fulfilment_status":
      return "/requests";
    default:
      // session_reminder, award, access_approved → the portal landing.
      return "/";
  }
}

/**
 * Build the absolute portal deep-link for a notification, under the active
 * addressing strategy (`brand-resolution.ts`): `<slug>.<apex><path>` in subdomain
 * mode, `<apex>/b/<slug>?next=<path>` in path mode. `env.SPROUT_URL` is the
 * apex/single-host origin. The slug comes from the directory mirror
 * (guestlist-owned), never caller input, so the host can't be steered.
 */
function portalHref(slug: string, path: string): string {
  return portalEntryUrl(env.SPROUT_URL, slug, path);
}

const FEED_LIMIT = 100;

/**
 * Gated GET: the caller's notifications across ALL their brands, newest-first.
 * Scoped to `user_id = caller` (the envelope's actor) — a Hub read never returns
 * another user's rows. The brand name + slug ride each row via a LEFT JOIN to
 * `org_brand_directory` so the feed can label the brand and build the cross-host
 * deep-link; an unmirrored org leaves both null (the row still renders). Rows whose
 * `type` falls outside the closed enum are dropped defensively.
 */
export const listNotifications = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<NotificationView[]> => {
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const result: NotificationRow[] = await db
      .select({
        id: notifications.id,
        brandId: notifications.brandId,
        brandName: orgBrandDirectory.name,
        brandSlug: orgBrandDirectory.slug,
        type: notifications.type,
        title: notifications.title,
        body: notifications.body,
        refType: notifications.refType,
        refId: notifications.refId,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .leftJoin(orgBrandDirectory, eq(orgBrandDirectory.orgId, notifications.brandId))
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(FEED_LIMIT);

    const out: NotificationView[] = [];
    for (const row of result) {
      const type = asNotificationType(row.type);
      if (!type) continue;
      out.push({
        id: row.id,
        brandId: row.brandId,
        brandName: row.brandName,
        brandSlug: row.brandSlug,
        type,
        title: row.title,
        body: row.body,
        refType: row.refType,
        refId: row.refId,
        read: row.readAt != null,
        createdAt: row.createdAt,
        href: row.brandSlug ? portalHref(row.brandSlug, deepLinkPath(type, row.refType)) : null,
      });
    }
    return out;
  });

const markReadInput = type({ id: "string >= 1" });

/**
 * Gated: mark ONE of the caller's notifications read (idempotent). The WHERE
 * clause pins `user_id = caller AND read_at IS NULL`, so a forged/foreign/
 * already-read id is a no-op (`{ ok: true }`), never a cross-user write.
 */
export const markRead = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(markReadInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const userId = context.principal.actor.id;
    const db = createDb(env.DB);
    await db
      .update(notifications)
      .set({ readAt: Date.now() })
      .where(
        and(
          eq(notifications.id, data.id),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
    return { ok: true };
  });

const markAllReadInput = type({ "brandId?": "string >= 1" });

/**
 * Gated: mark ALL the caller's unread notifications read, optionally narrowed to a
 * single brand. `user_id = caller` always anchors the UPDATE; `brandId` (input
 * here) only filters within the caller's own rows, so it can never touch another
 * user. Returns the count cleared.
 */
export const markAllRead = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(markAllReadInput)
  .handler(async ({ data, context }): Promise<{ ok: true; cleared: number }> => {
    const userId = context.principal.actor.id;
    const now = Date.now();
    const db = createDb(env.DB);

    const where = data.brandId
      ? and(
          eq(notifications.userId, userId),
          eq(notifications.brandId, data.brandId),
          isNull(notifications.readAt),
        )
      : and(eq(notifications.userId, userId), isNull(notifications.readAt));
    const res = await db.update(notifications).set({ readAt: now }).where(where);

    return { ok: true, cleared: res.meta.changes ?? 0 };
  });

/**
 * Gated GET: the caller's saved per-brand/per-type prefs. Only EXPLICIT rows are
 * returned (the grid treats an absent pair as default-on); `user_id = caller`
 * scopes the read. Rows with an out-of-enum `type` are dropped.
 */
export const getNotificationPrefs = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<NotificationPref[]> => {
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const result: PrefRow[] = await db
      .select({
        brandId: notificationPrefs.brandId,
        type: notificationPrefs.type,
        enabled: notificationPrefs.enabled,
      })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId));

    const out: NotificationPref[] = [];
    for (const row of result) {
      const type = asNotificationType(row.type);
      if (!type) continue;
      out.push({ brandId: row.brandId, type, enabled: row.enabled !== 0 });
    }
    return out;
  });

const setPrefInput = type({
  // Retained for wire-compat with the existing caller (the settings grid still
  // sends it), but IGNORED by the handler — the pref is written for the viewed
  // brand (`context.brand.id`) proven by `requireBrandAudience`, never this value.
  brandId: "string >= 1",
  // The closed enum, as the repo's inline string-union literal form.
  type: "'new_post' | 'new_comment' | 'chat' | 'contact_reply' | 'session_reminder' | 'award' | 'access_approved' | 'fulfilment_status'",
  enabled: "boolean",
});

/**
 * Gated: upsert one `notification_prefs(user_id, brand_id, type, enabled)` row for
 * the VIEWED brand. `requireBrandAudience` proves the caller is a portal-member OR
 * org-member OR platform-admin of that brand (budtenders included — the old
 * `getCallerOrgRole`-only gate wrongly rejected them), and exposes the authorized
 * brand as `context.brand.id`. `user_id` is ALWAYS the envelope's actor and
 * `brand_id` is ALWAYS `context.brand.id` — the client-supplied `data.brandId` is
 * ignored, so it is neither a forgery surface nor a cross-brand write. `enabled = 0`
 * is the explicit opt-out `emitNotification` honours; absence means default-on.
 */
export const setNotificationPref = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(setPrefInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const userId = context.principal.actor.id;
    const brandId = context.brand.id; // authorized viewed brand — never input

    const db = createDb(env.DB);
    const now = Date.now();
    await db
      .insert(notificationPrefs)
      .values({
        userId,
        brandId,
        type: data.type,
        enabled: data.enabled ? 1 : 0,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [notificationPrefs.userId, notificationPrefs.brandId, notificationPrefs.type],
        set: { enabled: data.enabled ? 1 : 0, updatedAt: now },
      });

    return { ok: true };
  });
