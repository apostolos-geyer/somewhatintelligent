/**
 * Landing server functions — the rotating hero + the banner rail (P1.C).
 *
 * All handlers are audience-gated, per the §02 invariant (brand_id is NEVER
 * input) and the D4b audience-only-portal decision:
 *
 *  - Every handler gates with `requireBrandAudience` and reads the viewed brand
 *    from `context.brand.id` (resolved + authorized once by the gate, never
 *    input, never the session's `activeOrgId`). The apex / no-brand case is
 *    rejected with `notFound` before the handler body runs.
 *  - `listActiveBanners` + the three engagement writes (impression/click/dismiss)
 *    additionally read the caller's id (`context.principal.actor.id`) — the
 *    banner list to subtract their per-user dismissals, the writes to attribute
 *    the analytics event.
 *
 * Hero `image_ref` is a roadie (R2) handle; we resolve it to a short-lived signed
 * URL via `getReadUrl`. Roadie I/O needs R2 secrets (inert in local dev), so each
 * resolve is wrapped — a slide whose URL doesn't resolve is dropped (the hero
 * falls back to its brand-tinted gradient; never a broken-image flash).
 *
 * banner impressions/clicks bump the denormalized counter in the SAME logical
 * write as the analytics_events row (see analytics.ts). dismissals are
 * INSERT-OR-IGNORE so a double-dismiss is a no-op.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { requireBrandAudience } from "@/lib/middleware/auth";
import { createDb } from "@/lib/db";
import { bannerCards, bannerDismissals, heroSlides } from "@/schema";
import { getRoadie } from "@/lib/roadie";
import { emitEvent } from "@/lib/analytics";
import { isSectionKey, type SectionKey } from "@/lib/sections";
import type { HeroSlide } from "@/components/shell/RotatingHero";
import type { BannerCardData } from "@/components/shell/BannerRail";

// ─── hero slides (authenticated, envelope-scoped) ───────────────────────────

/**
 * Audience-gated: the enabled hero slides for the viewed brand, in `order_idx`.
 * Each `image_ref` is resolved to an inline signed URL; a slide whose URL won't
 * resolve (roadie inert locally, deleted blob, etc.) is skipped so the carousel
 * never renders a broken image. `requireBrandAudience` rejects the apex /
 * no-brand case with `notFound` before the handler runs (plan doc D4b).
 */
export const listHeroSlides = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<HeroSlide[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: heroSlides.id,
        imageRef: heroSlides.imageRef,
        category: heroSlides.category,
        headline: heroSlides.headline,
      })
      .from(heroSlides)
      .where(and(eq(heroSlides.brandId, brandId), eq(heroSlides.enabled, 1)))
      .orderBy(asc(heroSlides.orderIdx), asc(heroSlides.id));

    const roadie = getRoadie();
    const slides: HeroSlide[] = [];
    for (const row of rows) {
      let imageUrl: string | null = null;
      if (/^(https?:|data:)/i.test(row.imageRef)) {
        // Already a resolvable URL (seeded/demo art or an external image) — used
        // as-is, so the hero renders without R2 in local dev.
        imageUrl = row.imageRef;
      } else {
        try {
          const res = await roadie.getReadUrl({
            referenceId: row.imageRef,
            disposition: "inline",
            permissionScope: `brand:${brandId}`,
          });
          if (res.ok) imageUrl = res.value.url;
        } catch {
          imageUrl = null; // roadie inert / failed — degrade to gradient
        }
      }
      // Skip slides whose URL didn't resolve — the hero degrades gracefully.
      if (!imageUrl) continue;
      slides.push({
        id: row.id,
        imageUrl,
        category: row.category,
        headline: row.headline,
      });
    }
    return slides;
  });

// ─── banner rail (authenticated, envelope-scoped) ───────────────────────────

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

/**
 * Authenticated: the live, non-dismissed banner cards for the caller's brand.
 * Windowed by `live_from <= now AND (expires_at IS NULL OR expires_at > now)`,
 * minus the caller's own `banner_dismissals` (a LEFT JOIN that keeps only rows
 * with no dismissal). brand = envelope `activeOrgId`, never input.
 */
export const listActiveBanners = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<BannerCardData[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const now = Date.now();
    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: bannerCards.id,
        categoryTag: bannerCards.categoryTag,
        headline: bannerCards.headline,
        line: bannerCards.line,
        linkJson: bannerCards.linkJson,
        dismissible: bannerCards.dismissible,
      })
      .from(bannerCards)
      .leftJoin(
        bannerDismissals,
        and(eq(bannerDismissals.bannerId, bannerCards.id), eq(bannerDismissals.userId, userId)),
      )
      .where(
        and(
          eq(bannerCards.brandId, brandId),
          or(isNull(bannerCards.liveFrom), lte(bannerCards.liveFrom, now)),
          or(isNull(bannerCards.expiresAt), gt(bannerCards.expiresAt, now)),
          isNull(bannerDismissals.bannerId),
        ),
      )
      .orderBy(asc(bannerCards.orderIdx), asc(bannerCards.id));

    return rows.map((row) => {
      const link = parseLink(row.linkJson);
      return {
        id: row.id,
        categoryTag: row.categoryTag,
        headline: row.headline,
        line: row.line,
        section: link.section,
        item: link.item,
        dismissible: row.dismissible !== 0,
      };
    });
  });

// ─── engagement writes (authenticated, envelope-scoped) ─────────────────────

const bannerIdInput = type({ bannerId: "string >= 1" });

/**
 * Bump `banner_cards.impressions` + emit a `banner_impression` event in the same
 * logical write. Scoped to the caller's brand so an impression can never be
 * recorded against another brand's banner. Fires once per card first-paint
 * (the BannerRail's IntersectionObserver dedupes client-side).
 */
export const recordBannerImpression = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(bannerIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    await db
      .update(bannerCards)
      .set({ impressions: sql`${bannerCards.impressions} + 1` })
      .where(and(eq(bannerCards.id, data.bannerId), eq(bannerCards.brandId, brandId)));

    await emitEvent({
      brandId,
      actorId: userId,
      type: "banner_impression",
      targetType: "banner",
      targetId: data.bannerId,
    });

    return { ok: true };
  });

const bannerClickInput = type({
  bannerId: "string >= 1",
  "section?": "string",
});

/**
 * Bump `banner_cards.clicks` + emit a `banner_click` event (with the linked
 * `section` in metadata) in the same logical write. Scoped to the caller's brand.
 */
export const recordBannerClick = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(bannerClickInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    await db
      .update(bannerCards)
      .set({ clicks: sql`${bannerCards.clicks} + 1` })
      .where(and(eq(bannerCards.id, data.bannerId), eq(bannerCards.brandId, brandId)));

    await emitEvent({
      brandId,
      actorId: userId,
      type: "banner_click",
      targetType: "banner",
      targetId: data.bannerId,
      metadata: data.section ? { section: data.section } : undefined,
    });

    return { ok: true };
  });

const dismissBannerInput = type({ bannerId: "string >= 1" });

/**
 * Record the caller's dismissal of a banner (sticky across sessions). INSERT OR
 * IGNORE keyed on (banner_id, user_id) so a repeat dismiss is a no-op. Gated to
 * the viewed brand: a `bannerId` that doesn't belong to `context.brand.id` (a
 * stale or foreign id) is silently ignored — the same idempotent no-op contract
 * as a repeat dismiss — so a dismissal row can never be written against another
 * brand's banner. No brand column on the dismissal row itself; the banner's own
 * brand scoping (verified here) governs which cards the caller can dismiss.
 */
export const dismissBanner = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(dismissBannerInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);

    // Verify the banner belongs to the viewed brand before recording a
    // dismissal. A stale/foreign bannerId is silently ignored (idempotent
    // no-op) so a dismissal row is never written against another brand's card.
    const owned = await db
      .select({ id: bannerCards.id })
      .from(bannerCards)
      .where(and(eq(bannerCards.id, data.bannerId), eq(bannerCards.brandId, brandId)))
      .limit(1);
    if (owned.length === 0) return { ok: true };

    await db
      .insert(bannerDismissals)
      .values({
        bannerId: data.bannerId,
        userId,
        dismissedAt: Date.now(),
      })
      .onConflictDoNothing();

    return { ok: true };
  });
