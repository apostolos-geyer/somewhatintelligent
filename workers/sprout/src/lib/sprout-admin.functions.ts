/**
 * Sprout-Admin (platform-operator god-mode) server functions — cross-brand
 * monitoring + org provisioning. EVERY fn here is gated with
 * `requireAdminMiddleware` (the comma-safe `isAdminRole` envelope gate). These
 * reads INTENTIONALLY bypass the `brand_id = activeOrgId` tenancy scoping that
 * Brand-Admin analytics enforce — that is sound ONLY behind this platform-admin
 * gate (a Sprout operator monitoring the whole platform, not one tenant). A
 * Brand-Admin can never reach these: the gate redirects non-admins.
 *
 * `analytics_events` is the append-only source of truth; the cross-brand rollups
 * GROUP BY over it and NEVER write/update it. Denormalized counters
 * (`assets.download_count`, `banner_cards.impressions/clicks`, `decks.page_count`)
 * are the cheap aggregate reads. `provisionOrg` is the one mutation: it calls
 * guestlist over `getGuestlist()` to create the org (the operator-only
 * `/admin/orgs/create` route — mirrors identity's `createOrgAsOperator`), then
 * seeds a `brand_config` row + an `org_brand_directory` mirror row (a new brand
 * is a row of data), and `writeAudit`s the provision in the same op.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { env } from "cloudflare:workers";
import { sql, type SQL } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { requireAdminMiddleware } from "@/lib/middleware/auth";
import { getGuestlist } from "@/lib/guestlist";
import { writeAudit } from "@/lib/audit";
import { brandTheme, orgBrandDirectory, portalConfig } from "@/schema";

// ─── listBrands — every provisioned brand + its per-brand counts ─────────────

/** One brand row for the cross-brand monitoring table. Joins the directory
 * mirror (slug/name) with its `brand_theme` lifecycle + a handful of per-brand
 * content counts. `hasConfig` is false for a directory row with no
 * `portal_config` yet (provisioned-but-unconfigured). */
export interface BrandSummary {
  orgId: string;
  slug: string;
  name: string;
  /** "draft" | "live" — the THEME lifecycle; null when no brand_theme row exists yet. */
  state: "draft" | "live" | null;
  livePublishedAt: number | null;
  hasConfig: boolean;
  products: number;
  decks: number;
  assets: number;
  /** Total append-only engagement events recorded for this brand. */
  events: number;
  syncedAt: number;
}

interface BrandDirRow {
  org_id: string;
  slug: string;
  name: string;
  synced_at: number;
  state: string | null;
  live_published_at: number | null;
  has_config: number;
}

/**
 * God-mode: list ALL brands from `org_brand_directory` (the slug→org mirror)
 * left-joined to `brand_theme` (lifecycle) + `portal_config` (configured?),
 * then attach per-brand content + event counts. No `brand_id` predicate by
 * design — this is the platform-wide operator view. Counts ride the per-brand
 * indexes. Ordered newest-synced first.
 */
export const listBrands = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<BrandSummary[]> => {
    const db = createDb(env.DB);
    const rows = await db.all<BrandDirRow>(
      sql`SELECT d.org_id, d.slug, d.name, d.synced_at,
              t.state AS state, t.live_published_at AS live_published_at,
              CASE WHEN c.org_id IS NULL THEN 0 ELSE 1 END AS has_config
       FROM org_brand_directory d
       LEFT JOIN brand_theme t ON t.org_id = d.org_id
       LEFT JOIN portal_config c ON c.org_id = d.org_id
       ORDER BY d.synced_at DESC`,
    );

    if (rows.length === 0) return [];

    // Per-brand content + event counts in one grouped pass each, then merge by
    // org_id in JS. GROUP BY rides the leading-brand indexes; this avoids N+1
    // per-brand round-trips as the platform grows.
    const [products, decks, assets, events] = await Promise.all([
      db.all<{ brand_id: string; n: number }>(
        sql`SELECT brand_id, COUNT(*) AS n FROM products GROUP BY brand_id`,
      ),
      db.all<{ brand_id: string; n: number }>(
        sql`SELECT brand_id, COUNT(*) AS n FROM decks GROUP BY brand_id`,
      ),
      db.all<{ brand_id: string; n: number }>(
        sql`SELECT brand_id, COUNT(*) AS n FROM assets GROUP BY brand_id`,
      ),
      db.all<{ brand_id: string; n: number }>(
        sql`SELECT brand_id, COUNT(*) AS n FROM analytics_events GROUP BY brand_id`,
      ),
    ]);

    const countMap = (r: Array<{ brand_id: string; n: number }>) => {
      const m = new Map<string, number>();
      for (const row of r) m.set(row.brand_id, row.n);
      return m;
    };
    const productByBrand = countMap(products);
    const deckByBrand = countMap(decks);
    const assetByBrand = countMap(assets);
    const eventByBrand = countMap(events);

    return rows.map((r) => ({
      orgId: r.org_id,
      slug: r.slug,
      name: r.name,
      state: r.state === "live" ? "live" : r.state === "draft" ? "draft" : null,
      livePublishedAt: r.live_published_at,
      hasConfig: r.has_config === 1,
      products: productByBrand.get(r.org_id) ?? 0,
      decks: deckByBrand.get(r.org_id) ?? 0,
      assets: assetByBrand.get(r.org_id) ?? 0,
      events: eventByBrand.get(r.org_id) ?? 0,
      syncedAt: r.synced_at,
    }));
  });

// ─── provisionOrg — create an org (guestlist) + seed its brand rows ──────────

/**
 * Input is the new org's identity + its first owner. `slug` is the UNIQUE host
 * label (kebab-case); guestlist re-validates the pattern and rejects collisions.
 * `ownerUserId` is the platform user who becomes the org owner — the operator
 * picks an existing identity user, exactly like identity's onboarding flow.
 */
const provisionOrgInput = type({
  name: "string >= 2",
  slug: "string >= 2",
  ownerUserId: "string >= 1",
});

export type ProvisionOrgResult =
  | { ok: true; orgId: string; slug: string; name: string }
  | { ok: false; error: "slug_taken" | "unknown"; message: string };

/**
 * God-mode: provision a brand-new tenant. Two-phase, in order:
 *  1. guestlist creates the org via the operator-only `/admin/orgs/create` route
 *     (owned by `ownerUserId`, not the calling operator — the BA-documented
 *     no-session-headers + explicit-userId path). On a slug collision guestlist
 *     returns 409 `slug_taken`, surfaced to the form rather than thrown.
 *  2. sprout seeds the per-org runtime rows a brand needs to exist: a draft
 *     `brand_config` (so Brand-Admin Setup has a row to edit) and an
 *     `org_brand_directory` mirror (so host→brand resolution finds it without
 *     waiting on the guestlist org-hook push). Both keyed by the returned org id.
 *
 * `writeAudit` records the provision (brandId = the new org) in the same op. The
 * operator's identity is the audited actor; `brand_id` here is the org we just
 * created, NOT the operator's active org (god-mode by construction).
 */
export const provisionOrg = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator(provisionOrgInput)
  .handler(async ({ data, context }): Promise<ProvisionOrgResult> => {
    const actorId = context.principal.actor.id;
    const name = data.name.trim();
    const slug = data.slug.trim();

    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.orgs.create.post({
      name,
      slug,
      ownerUserId: data.ownerUserId,
    });
    if (res.error) {
      const body = res.error.value as { error?: string; message?: string } | null;
      if (body?.error === "slug_taken") {
        return { ok: false, error: "slug_taken", message: body.message ?? "That slug is taken." };
      }
      return {
        ok: false,
        error: "unknown",
        message: body?.message ?? JSON.stringify(res.error.value),
      };
    }
    const org = res.data?.organization as { id: string; slug: string; name: string } | undefined;
    if (!org) {
      return { ok: false, error: "unknown", message: "No org returned from guestlist." };
    }

    // Seed the per-org runtime rows. A brand IS a row of data: the directory
    // mirror makes host→brand resolution work immediately; the theme + content
    // rows mean Brand-Admin Setup edits existing rows (no separate create step).
    const now = Date.now();
    const db = createDb(env.DB);
    await db
      .insert(orgBrandDirectory)
      .values({ orgId: org.id, slug: org.slug, name: org.name, syncedAt: now })
      .onConflictDoUpdate({
        target: orgBrandDirectory.orgId,
        set: { slug: org.slug, name: org.name, syncedAt: now },
      });

    await db.batch([
      db
        .insert(brandTheme)
        .values({ id: ulid(), orgId: org.id, state: "draft", createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: brandTheme.orgId }),
      db
        .insert(portalConfig)
        .values({ id: ulid(), orgId: org.id, name: org.name, createdAt: now, updatedAt: now })
        .onConflictDoNothing({ target: portalConfig.orgId }),
    ]);

    await writeAudit({
      brandId: org.id,
      action: "org.provision",
      actorId,
      targetType: "organization",
      targetId: org.id,
      meta: { slug: org.slug, name: org.name, ownerUserId: data.ownerUserId },
    });

    return { ok: true, orgId: org.id, slug: org.slug, name: org.name };
  });

// ─── getSystemHealth — platform-wide row counts + recent activity ────────────

/** A snapshot the operator dashboard reads to eyeball platform health: total
 * tenant/content/engagement row counts + how fresh the latest activity is. All
 * cross-brand (no `brand_id` predicate) — god-mode by construction. */
export interface SystemHealth {
  brands: number;
  /** Brands whose config has been flipped to live at least once. */
  liveBrands: number;
  users: number;
  products: number;
  decks: number;
  assets: number;
  events: number;
  aiQuestions: number;
  sessions: number;
  /** Engagement events in the trailing 24h — a coarse "is the platform busy?". */
  eventsLast24h: number;
  /** created_at of the most recent engagement event (ms epoch), or null. */
  lastEventAt: number | null;
  /** created_at of the most recent audit row (ms epoch), or null. */
  lastAuditAt: number | null;
}

/**
 * God-mode platform health rollup. Each count is a single grouped/aggregate
 * scan; "users" is approximated by DISTINCT actors in the event stream (sprout
 * holds no user table — identity owns users), which is the right denominator for
 * an engagement-health view anyway. Degrades to zeros before any rows exist.
 */
export const getSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<SystemHealth> => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const db = createDb(env.DB);
    const one = async (query: SQL) => (await db.get<{ n: number | null }>(query))?.n ?? 0;

    const [
      brands,
      liveBrands,
      users,
      products,
      decks,
      assets,
      events,
      aiQuestions,
      sessions,
      eventsLast24h,
      lastEvent,
      lastAudit,
    ] = await Promise.all([
      one(sql`SELECT COUNT(*) AS n FROM org_brand_directory`),
      one(sql`SELECT COUNT(*) AS n FROM brand_config WHERE state = 'live'`),
      one(sql`SELECT COUNT(DISTINCT actor_id) AS n FROM analytics_events`),
      one(sql`SELECT COUNT(*) AS n FROM products`),
      one(sql`SELECT COUNT(*) AS n FROM decks`),
      one(sql`SELECT COUNT(*) AS n FROM assets`),
      one(sql`SELECT COUNT(*) AS n FROM analytics_events`),
      one(sql`SELECT COUNT(*) AS n FROM ai_qa_log`),
      one(sql`SELECT COUNT(*) AS n FROM group_sessions`),
      one(sql`SELECT COUNT(*) AS n FROM analytics_events WHERE created_at >= ${dayAgo}`),
      db.get<{ n: number | null }>(sql`SELECT MAX(created_at) AS n FROM analytics_events`),
      db.get<{ n: number | null }>(sql`SELECT MAX(created_at) AS n FROM audit_log`),
    ]);

    return {
      brands,
      liveBrands,
      users,
      products,
      decks,
      assets,
      events,
      aiQuestions,
      sessions,
      eventsLast24h,
      lastEventAt: lastEvent?.n ?? null,
      lastAuditAt: lastAudit?.n ?? null,
    };
  });

// ─── getCrossBrandStats — engagement rollup across every brand ───────────────

/** Per-brand engagement totals for the cross-brand comparison view. */
export interface CrossBrandStat {
  brandId: string;
  /** Resolved display name from the directory mirror (falls back to the id). */
  name: string;
  slug: string;
  events: number;
  /** DISTINCT actors who produced any event for this brand. */
  activeUsers: number;
}

/** Platform-wide engagement totals by event type (the closed analytics vocab). */
export interface CrossBrandTypeTotal {
  type: string;
  count: number;
}

export interface CrossBrandStats {
  /** Per-brand engagement, descending by event volume. */
  brands: CrossBrandStat[];
  /** Platform-wide per-type totals, descending by count. */
  byType: CrossBrandTypeTotal[];
  /** Total events counted across all brands in the window. */
  total: number;
  /** Inclusive lower bound (ms epoch) applied, or null for all-time. */
  since: number | null;
}

const getCrossBrandStatsInput = type({
  "since?": "number >= 0",
});

/**
 * God-mode cross-brand engagement rollup over `analytics_events`. Two grouped
 * scans (by brand, by type) over the whole stream — NO `brand_id` predicate,
 * which is the entire point of the operator view. The per-brand totals are
 * joined to the directory mirror for display names. An optional `since` trims to
 * a trailing window (rides the `created_at` columns of the brand_* indexes).
 */
export const getCrossBrandStats = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator(getCrossBrandStatsInput)
  .handler(async ({ data }): Promise<CrossBrandStats> => {
    const since = data.since ?? null;
    const where = since !== null ? sql`WHERE created_at >= ${since}` : sql``;

    const db = createDb(env.DB);
    const [byBrand, byType, names] = await Promise.all([
      db.all<{ brand_id: string; events: number; users: number }>(
        sql`SELECT brand_id, COUNT(*) AS events, COUNT(DISTINCT actor_id) AS users
         FROM analytics_events ${where}
         GROUP BY brand_id`,
      ),
      db.all<{ type: string; n: number }>(
        sql`SELECT type, COUNT(*) AS n
         FROM analytics_events ${where}
         GROUP BY type`,
      ),
      db
        .select({
          orgId: orgBrandDirectory.orgId,
          slug: orgBrandDirectory.slug,
          name: orgBrandDirectory.name,
        })
        .from(orgBrandDirectory),
    ]);

    const nameByOrg = new Map<string, { slug: string; name: string }>();
    for (const r of names) {
      nameByOrg.set(r.orgId, { slug: r.slug, name: r.name });
    }

    const brands: CrossBrandStat[] = byBrand
      .map((r) => {
        const meta = nameByOrg.get(r.brand_id);
        return {
          brandId: r.brand_id,
          name: meta?.name ?? r.brand_id,
          slug: meta?.slug ?? "",
          events: r.events,
          activeUsers: r.users,
        };
      })
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));

    const typeTotals: CrossBrandTypeTotal[] = byType
      .map((r) => ({ type: r.type, count: r.n }))
      .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));

    const total = typeTotals.reduce((sum, t) => sum + t.count, 0);

    return { brands, byType: typeTotals, total, since };
  });
