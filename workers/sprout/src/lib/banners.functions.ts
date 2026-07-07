/**
 * Banner-card management server functions (P3.D) — the ADMIN surface + reporting
 * for the landing banner rail. The PUBLIC budtender reads (the live list) +
 * impression/click/dismiss writes live in `landing.functions.ts` (P1.C); this
 * file owns only the Brand-Admin config + the per-banner reporting, and never
 * duplicates those reads.
 *
 * Banner cards are CONFIG, not content: there is no soft-delete column — removal
 * is a real SQL DELETE (the cascade FK drops the per-user `banner_dismissals`).
 * Every mutation gates IN-HANDLER on `decideBrandAdmin({ actorRole, orgRole })`
 * (owner|admin in the brand's BA org, or platform admin) and calls `writeAudit`
 * in the same logical write.
 *
 * `link_json` is an IN-PLATFORM jump only — `{ section, item }`, never an
 * external URL. `section` is validated against the canonical six-key section
 * enum (`SECTION_KEYS`); a forged/unknown section is rejected at the I/O edge.
 *
 * brand_id is ALWAYS the verified envelope's `activeOrgId`, never input — a
 * forged `bannerId` from another brand resolves to "not found", never another
 * brand's row. The admin reads (`listAdminBanners`, `getBannerReport`) surface
 * `impressions`/`clicks`/CTR; the live/expired status is COMPUTED from the
 * `[live_from, expires_at]` window against now.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, desc, eq } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { requireBrandAdmin } from "@/lib/middleware/auth";
import { createDb } from "@/lib/db";
import { bannerCards } from "@/schema";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { nullableTrim } from "@/lib/strings";
import { writeAudit } from "@/lib/audit";
import { isSectionKey, type SectionKey } from "@/lib/sections";

/** The lifecycle status a banner card is in, computed from its window vs now. */
export type BannerStatus = "scheduled" | "live" | "expired";

/** A banner card as the admin management table renders it. */
export interface AdminBannerView {
  id: string;
  categoryTag: string | null;
  headline: string;
  line: string;
  /** In-platform jump target — section is one of the six keys (or null). */
  section: SectionKey | null;
  item: string | null;
  dismissible: boolean;
  liveFrom: number | null;
  expiresAt: number | null;
  impressions: number;
  clicks: number;
  /** clicks / impressions, or null when there are no impressions yet. */
  ctr: number | null;
  orderIdx: number;
  createdAt: number;
  /** scheduled (live_from in the future) | live | expired. */
  status: BannerStatus;
}

/** One row of the reporting table — the engagement counters + computed CTR. */
export interface BannerReportRow {
  id: string;
  headline: string;
  impressions: number;
  clicks: number;
  /** clicks / impressions, or null when there are no impressions yet. */
  ctr: number | null;
  status: BannerStatus;
}

// Drizzle returns rows keyed by the schema's camelCase TS field names.
interface BannerRow {
  id: string;
  categoryTag: string | null;
  headline: string;
  line: string;
  linkJson: string;
  dismissible: number;
  liveFrom: number | null;
  expiresAt: number | null;
  impressions: number;
  clicks: number;
  orderIdx: number;
  createdAt: number;
}

/** Safe parse of `banner_cards.link_json` → in-platform { section, item }. */
function parseLink(json: string): { section: SectionKey | null; item: string | null } {
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    return {
      section: isSectionKey(raw.section) ? raw.section : null,
      item: typeof raw.item === "string" ? raw.item : null,
    };
  } catch {
    return { section: null, item: null };
  }
}

/** clicks / impressions, or null when there are no impressions yet. */
function computeCtr(impressions: number, clicks: number): number | null {
  return impressions > 0 ? clicks / impressions : null;
}

/** Lifecycle status from the `[live_from, expires_at]` window against `now`. */
function computeStatus(
  liveFrom: number | null,
  expiresAt: number | null,
  now: number,
): BannerStatus {
  if (liveFrom != null && liveFrom > now) return "scheduled";
  if (expiresAt != null && expiresAt <= now) return "expired";
  return "live";
}

function mapAdminView(row: BannerRow, now: number): AdminBannerView {
  const link = parseLink(row.linkJson);
  return {
    id: row.id,
    categoryTag: row.categoryTag,
    headline: row.headline,
    line: row.line,
    section: link.section,
    item: link.item,
    dismissible: row.dismissible !== 0,
    liveFrom: row.liveFrom,
    expiresAt: row.expiresAt,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: computeCtr(row.impressions, row.clicks),
    orderIdx: row.orderIdx,
    createdAt: row.createdAt,
    status: computeStatus(row.liveFrom, row.expiresAt, now),
  };
}

// The admin-view column projection — matches the BannerRow camelCase shape.
const bannerColumns = {
  id: bannerCards.id,
  categoryTag: bannerCards.categoryTag,
  headline: bannerCards.headline,
  line: bannerCards.line,
  linkJson: bannerCards.linkJson,
  dismissible: bannerCards.dismissible,
  liveFrom: bannerCards.liveFrom,
  expiresAt: bannerCards.expiresAt,
  impressions: bannerCards.impressions,
  clicks: bannerCards.clicks,
  orderIdx: bannerCards.orderIdx,
  createdAt: bannerCards.createdAt,
} as const;

// ─── admin reads (brand-role gated, envelope-scoped) ────────────────────────

/**
 * Admin: every banner card for the caller's brand — incl. scheduled + expired —
 * with its impressions/clicks/CTR and computed live/scheduled/expired status,
 * ordered by `order_idx`. brand = envelope `activeOrgId`, never input. Brand-role
 * gated so a plain budtender can't enumerate the brand's banner config.
 */
export const listAdminBanners = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminBannerView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const now = Date.now();
    const db = createDb(env.DB);
    const rows = await db
      .select(bannerColumns)
      .from(bannerCards)
      .where(eq(bannerCards.brandId, brandId))
      .orderBy(asc(bannerCards.orderIdx), asc(bannerCards.createdAt), asc(bannerCards.id));

    return rows.map((row) => mapAdminView(row, now));
  });

/**
 * Admin: the per-banner reporting projection — impressions, clicks, CTR, and the
 * computed status — for the caller's brand, ordered by impressions desc so the
 * highest-reach cards lead the table. brand = envelope `activeOrgId`, never
 * input. Brand-role gated.
 */
export const getBannerReport = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<BannerReportRow[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const now = Date.now();
    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: bannerCards.id,
        headline: bannerCards.headline,
        liveFrom: bannerCards.liveFrom,
        expiresAt: bannerCards.expiresAt,
        impressions: bannerCards.impressions,
        clicks: bannerCards.clicks,
      })
      .from(bannerCards)
      .where(eq(bannerCards.brandId, brandId))
      .orderBy(desc(bannerCards.impressions), desc(bannerCards.clicks), asc(bannerCards.id));

    return rows.map((row) => ({
      id: row.id,
      headline: row.headline,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: computeCtr(row.impressions, row.clicks),
      status: computeStatus(row.liveFrom, row.expiresAt, now),
    }));
  });

// ─── admin mutations (brand-role gated, in-handler decideBrandAdmin) ────────

const upsertBannerInput = type({
  "bannerId?": "string >= 1",
  "categoryTag?": "string",
  headline: "string >= 1",
  "line?": "string",
  /** In-platform link target — section MUST be one of the six section keys. */
  "section?": "'assets' | 'decks' | 'quizzes' | 'feed' | 'chat' | 'contact'",
  "item?": "string",
  dismissible: "boolean",
  "liveFrom?": "number >= 0",
  "expiresAt?": "number >= 0",
  "orderIdx?": "number >= 0",
});

/**
 * Admin: create or edit a banner card. Without `bannerId` it INSERTs a new row;
 * with one it UPDATEs the caller's brand's card (the `brand_id` guard makes a
 * cross-brand edit a no-op → 404). The link is an IN-PLATFORM `{ section, item }`
 * jump — NEVER an external URL — and `section` is constrained at the edge to the
 * canonical six-key enum; an `item` without a `section` is dropped. brand =
 * envelope `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const upsertBanner = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertBannerInput)
  .handler(async ({ data, context }): Promise<{ ok: true; bannerId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    // In-platform link only: keep a section (validated to the six keys) and an
    // optional item; an item without a section is meaningless, so drop it.
    const section = isSectionKey(data.section) ? data.section : null;
    const item = section ? nullableTrim(data.item) : null;
    const linkJson = JSON.stringify(section ? { section, ...(item ? { item } : {}) } : {});

    const now = Date.now();
    const categoryTag = nullableTrim(data.categoryTag);
    const line = (data.line ?? "").trim();
    const liveFrom = data.liveFrom ?? null;
    const expiresAt = data.expiresAt ?? null;
    const orderIdx = data.orderIdx ?? 0;

    const db = createDb(env.DB);

    if (data.bannerId) {
      const updated = await db
        .update(bannerCards)
        .set({
          categoryTag,
          headline: data.headline.trim(),
          line,
          linkJson,
          dismissible: data.dismissible ? 1 : 0,
          liveFrom,
          expiresAt,
          orderIdx,
        })
        .where(and(eq(bannerCards.id, data.bannerId), eq(bannerCards.brandId, brandId)))
        .returning({ id: bannerCards.id });
      if (updated.length === 0) throw new Error("not_found");

      await writeAudit({
        brandId,
        action: "banner.upsert",
        actorId: userId,
        targetType: "banner",
        targetId: data.bannerId,
        meta: { headline: data.headline.trim(), section },
      });
      return { ok: true, bannerId: data.bannerId };
    }

    const bannerId = ulid();
    await db.insert(bannerCards).values({
      id: bannerId,
      brandId,
      categoryTag,
      headline: data.headline.trim(),
      line,
      linkJson,
      dismissible: data.dismissible ? 1 : 0,
      liveFrom,
      expiresAt,
      orderIdx,
      createdAt: now,
    });

    await writeAudit({
      brandId,
      action: "banner.upsert",
      actorId: userId,
      targetType: "banner",
      targetId: bannerId,
      meta: { headline: data.headline.trim(), section },
    });
    return { ok: true, bannerId };
  });

const bannerIdInput = type({ bannerId: "string >= 1" });

/**
 * Admin: DELETE a banner card (real DELETE — banners are config, not content, so
 * there is no soft-delete path). The `banner_dismissals` FK cascade drops the
 * per-user dismissals with it. The `brand_id` guard scopes the DELETE so an admin
 * can't reach across tenants; a foreign/unknown `bannerId` is a no-op → 404.
 * brand = envelope `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const deleteBanner = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(bannerIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const deleted = await db
      .delete(bannerCards)
      .where(and(eq(bannerCards.id, data.bannerId), eq(bannerCards.brandId, brandId)))
      .returning({ id: bannerCards.id });
    if (deleted.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "banner.delete",
      actorId: userId,
      targetType: "banner",
      targetId: data.bannerId,
    });

    return { ok: true };
  });
