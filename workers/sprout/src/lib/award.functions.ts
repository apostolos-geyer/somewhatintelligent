/**
 * Hub award + platform-leaderboard server functions (P5.B). These EXTEND the Hub
 * read surface that `hub.functions.ts` opened (the hubshell stream owns that file;
 * this is a separate module so the two streams never touch the same lines). Like
 * `getLeaderboard`, every read here serves the MATERIALIZED `user_brand_scores`
 * snapshot — the cron (`jobs/cron.ts`) is the only writer — so the Hub never
 * re-runs the score math or scans live.
 *
 * Tenancy is the Hub variant: these fns are PLATFORM-WIDE (cross-brand) but scoped
 * to the CALLER'S OWN memberships. The caller's brands come from the better-auth
 * org plugin (`getGuestlist().auth.organization.list()` — the caller's own orgs,
 * resolved from their forwarded session cookies, NEVER input). A Hub read can
 * therefore aggregate across the brands the user belongs to, yet never return a
 * brand they aren't a member of. If the org-list call is unavailable or errors we
 * DEGRADE to an empty membership set (never throw) — an unranked, award-less Hub.
 *
 * Education-FUND framing is product law: the award is an education fund the brand
 * tops up for the period's top budtender. Nothing here says prize / reward / cash.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { educationAward, orgBrandDirectory, userBrandScores } from "@/schema";
import { requireUserMiddleware } from "@/lib/middleware/auth";
import { getGuestlist } from "@/lib/guestlist";
import { listPortalBrandIds } from "@/lib/portal-members";
import { resolveMemberNames } from "@/lib/member-names";
import { currentPeriod } from "@/lib/score";
import type { LeaderboardEntry } from "@/lib/hub.functions";

/** The platform-wide board: top-N across the caller's brands + their own rank. */
export interface PlatformLeaderboardView {
  period: string;
  entries: LeaderboardEntry[];
  /** The caller's rank even when outside the top N; null if unranked this period. */
  ownRank: number | null;
  /** The caller's aggregate score this period; null if they have no score rows. */
  ownScore: number | null;
}

/**
 * One brand's Education-Award snapshot for the current period — the hero Card's
 * read. `leader`/`gapToFirst` are computed from the materialized snapshot, never a
 * live scan. The leader is SEMI-ANONYMOUS by design: only the score surfaces
 * ("Leader · N pts"), never another budtender's identity.
 */
export interface AwardView {
  brandId: string;
  brandName: string;
  period: string;
  /** The education-fund framing — what the fund covers (course fees, etc.). */
  coversText: string | null;
  /** Epoch-ms the period's window closes (the live <Countdown> target). */
  closesAt: number;
  /** The current leader's score this period, or null if the board is empty. */
  leaderScore: number | null;
  /** The caller's score this period for this brand (0 when they have no row). */
  ownScore: number;
  /** Points between the caller and first place (0 when the caller leads). */
  gapToFirst: number;
}

/** Last month's closed-period winner for one brand (the "Winner" strip). */
export interface LastMonthWinnerView {
  brandId: string;
  brandName: string;
  period: string;
  /** The stamped, semi-anonymous winner handle; null if no winner was recorded. */
  winnerName: string | null;
}

const TOP_N = 25;

/** A brand the caller belongs to, joined to its directory name. */
interface CallerBrand {
  id: string;
  name: string;
}

interface ScoreRow {
  user_id: string;
  score: number;
  computed_at: number;
}

/**
 * The caller's OWN brands — the UNION of their better-auth org memberships AND
 * their portal memberships (budtenders are portal members, NOT org members, so
 * the canonical Hub user has ZERO orgs; resolving only orgs left their
 * leaderboard + award permanently empty). Kept as an org∪portal union for the
 * leaderboard/award scope; it converges with `hub.functions`'
 * `listAudienceBrandIds` because org staff are materialized into `portal_members`,
 * so the Hub's components agree on which brands the caller belongs to. Joined to
 * `org_brand_directory` for the display name. DEGRADES to
 * `[]` per-source on any failure: neither the org-list call nor the portal lookup
 * may throw out of a Hub read. Brands with no directory row fall back to the org
 * name, then a generic label.
 */
async function callerBrands(userId: string): Promise<CallerBrand[]> {
  let orgs: Array<{ id: string; name?: string }> = [];
  try {
    const res = await getGuestlist().auth.organization.list();
    orgs = (res.data ?? []) as Array<{ id: string; name?: string }>;
  } catch {
    orgs = []; // org list unavailable → fall back to portal memberships only
  }

  let portalBrandIds: string[] = [];
  try {
    portalBrandIds = await listPortalBrandIds(userId);
  } catch {
    portalBrandIds = []; // portal lookup unavailable → org memberships only
  }

  const ids = [...new Set([...orgs.map((o) => o.id), ...portalBrandIds])];
  if (ids.length === 0) return [];

  // One directory lookup for the names (the public slug/name mirror). A missing
  // row falls back to the org's own name (portal-only brands always have a
  // directory row), then a generic label, so the Hub still labels the brand.
  const db = createDb(env.DB);
  const dir = await db
    .select({ orgId: orgBrandDirectory.orgId, name: orgBrandDirectory.name })
    .from(orgBrandDirectory)
    .where(inArray(orgBrandDirectory.orgId, ids));
  const nameByOrg = new Map(dir.map((r) => [r.orgId, r.name]));
  const orgNameById = new Map(orgs.map((o) => [o.id, o.name]));

  return ids.map((id) => ({
    id,
    name: nameByOrg.get(id) ?? orgNameById.get(id) ?? "Brand",
  }));
}

/**
 * Gated GET: the PLATFORM-WIDE leaderboard for a period across the caller's own
 * brands. A budtender's score is the SUM of their `user_brand_scores` rows over
 * every brand they belong to this period; the board is the top N of those sums,
 * with the caller's own rank pinned even when they fall outside the window.
 *
 * `period` defaults to the current UTC month. The read aggregates only over the
 * caller's resolved brand ids (their own memberships), so it can never surface a
 * brand they aren't in. No memberships → an empty board for the resolved period.
 * Names stay null this phase (resolved from guestlist later, like `getLeaderboard`).
 */
export const getPlatformLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<PlatformLeaderboardView> => {
    const userId = context.principal.actor.id;
    const period = currentPeriod(Date.now());

    const brands = await callerBrands(userId);
    if (brands.length === 0) return { period, entries: [], ownRank: null, ownScore: null };

    const db = createDb(env.DB);
    const brandIds = brands.map((b) => b.id);
    // Parameterized brand-id list for the raw aggregate SQL (escape hatch).
    const brandIdList = sql.join(
      brandIds.map((b) => sql`${b}`),
      sql`, `,
    );

    // Per-user aggregate across the caller's brands for the period. SUM(score)
    // is the platform total; MIN(computed_at) is the deterministic tie-break
    // companion (earliest computation ranks first on equal totals), mirroring the
    // brand board's score DESC, computed_at ASC, user_id ASC order. SUM/GROUP BY
    // aggregate ⇒ Drizzle sql escape hatch.
    const top = await db.all<ScoreRow>(sql`
      SELECT user_id, SUM(score) AS score, MIN(computed_at) AS computed_at
        FROM user_brand_scores
       WHERE period = ${period} AND brand_id IN (${brandIdList})
       GROUP BY user_id
       ORDER BY score DESC, computed_at ASC, user_id ASC
       LIMIT ${TOP_N}
    `);

    // Resolve display names across the caller's brands (union of the per-brand
    // member maps — a budtender ranks on the cross-brand board, so their name may
    // come from any of their brands). Degrades to a shortened id when a lookup
    // fails. Only the rendered top N need names.
    const nameMaps = await Promise.all(brandIds.map((b) => resolveMemberNames(b)));
    const names = new Map<string, string>();
    for (const m of nameMaps) {
      for (const [id, n] of m) if (!names.has(id)) names.set(id, n);
    }

    const entries: LeaderboardEntry[] = top.map((row, i) => ({
      userId: row.user_id,
      displayName: names.get(row.user_id) ?? null,
      score: row.score,
      rank: i + 1,
    }));

    // The caller's own aggregate for this period across the same brands.
    const own = (
      await db.all<ScoreRow>(sql`
        SELECT user_id, SUM(score) AS score, MIN(computed_at) AS computed_at
          FROM user_brand_scores
         WHERE period = ${period} AND brand_id IN (${brandIdList}) AND user_id = ${userId}
      `)
    ).at(0);

    // A GROUP-less aggregate over zero rows yields one NULL-score row; treat that
    // as "unranked" (the caller has no score this period across their brands).
    if (!own || own.score == null) return { period, entries, ownRank: null, ownScore: null };

    // Rank = (# users with a strictly-better aggregate) + 1, using the SAME total
    // order as the board (higher sum, or equal sum with an earlier MIN(computed_at),
    // or equal sum+computed_at with a smaller user_id). Computed over the caller's
    // brands only, so the platform rank stays scoped to their memberships.
    // COUNT over a GROUP BY/HAVING subquery ⇒ Drizzle sql escape hatch.
    const better = (
      await db.all<{ n: number }>(sql`
        SELECT COUNT(*) AS n FROM (
            SELECT user_id, SUM(score) AS s, MIN(computed_at) AS c
              FROM user_brand_scores
             WHERE period = ${period} AND brand_id IN (${brandIdList})
             GROUP BY user_id
            HAVING s > ${own.score}
                OR (s = ${own.score} AND c < ${own.computed_at})
                OR (s = ${own.score} AND c = ${own.computed_at} AND user_id < ${userId})
          )
      `)
    ).at(0);

    const ownRank = (better?.n ?? 0) + 1;
    return { period, entries, ownRank, ownScore: own.score };
  });

/**
 * Gated GET: the caller's brands' `education_award` rows for the CURRENT period —
 * the hero Card's data. For each of the caller's brands that has an award row this
 * period we surface the education-fund framing (`covers_text`), the live-countdown
 * target (`closes_at`), the SEMI-ANONYMOUS leader score, and the caller's own gap
 * to first — all computed from the materialized snapshot.
 *
 * Tenancy: brands come from the caller's own memberships; the leader + gap are
 * read from `user_brand_scores` scoped to that brand + period, so a Hub read never
 * leaks a brand the caller isn't in. No award row for a brand this period ⇒ it's
 * simply omitted (a brand without an active fund window has nothing to show).
 */
export const getAward = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<AwardView[]> => {
    const userId = context.principal.actor.id;
    const period = currentPeriod(Date.now());

    const brands = await callerBrands(userId);
    if (brands.length === 0) return [];
    const nameByBrand = new Map(brands.map((b) => [b.id, b.name]));

    const db = createDb(env.DB);
    const brandIds = brands.map((b) => b.id);

    // The active award windows for the caller's brands this period.
    const awards = await db
      .select({
        brandId: educationAward.brandId,
        coversText: educationAward.coversText,
        closesAt: educationAward.closesAt,
      })
      .from(educationAward)
      .where(and(eq(educationAward.period, period), inArray(educationAward.brandId, brandIds)));

    const views: AwardView[] = [];
    for (const award of awards) {
      // The brand's current leader score (semi-anonymous — only the score shows).
      const leader = (
        await db
          .select({ score: userBrandScores.score })
          .from(userBrandScores)
          .where(
            and(eq(userBrandScores.brandId, award.brandId), eq(userBrandScores.period, period)),
          )
          .orderBy(
            desc(userBrandScores.score),
            asc(userBrandScores.computedAt),
            asc(userBrandScores.userId),
          )
          .limit(1)
      ).at(0);

      // The caller's own score for this brand+period (0 when they have no row).
      const own = (
        await db
          .select({ score: userBrandScores.score })
          .from(userBrandScores)
          .where(
            and(
              eq(userBrandScores.brandId, award.brandId),
              eq(userBrandScores.period, period),
              eq(userBrandScores.userId, userId),
            ),
          )
          .limit(1)
      ).at(0);

      const leaderScore = leader?.score ?? null;
      const ownScore = own?.score ?? 0;
      // Gap to first never goes negative (the caller may already lead).
      const gapToFirst = leaderScore != null ? Math.max(0, leaderScore - ownScore) : 0;

      views.push({
        brandId: award.brandId,
        brandName: nameByBrand.get(award.brandId) ?? "Brand",
        period,
        coversText: award.coversText,
        closesAt: award.closesAt,
        leaderScore,
        ownScore,
        gapToFirst,
      });
    }

    return views;
  });

/**
 * Gated GET: last month's WINNER for each of the caller's brands — the "Last
 * Month's Winner" strip. Reads the PRIOR closed period's `education_award` rows
 * (the cron stamps `winner_*` at close); a brand with no recorded winner is
 * omitted. The winner handle is the stamped semi-anonymous name (no identity
 * leak). Scoped to the caller's own brands, so no foreign-brand winner surfaces.
 */
export const getLastMonthWinner = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<LastMonthWinnerView[]> => {
    const userId = context.principal.actor.id;
    const period = priorPeriod(Date.now());

    const brands = await callerBrands(userId);
    if (brands.length === 0) return [];
    const nameByBrand = new Map(brands.map((b) => [b.id, b.name]));

    const db = createDb(env.DB);
    const brandIds = brands.map((b) => b.id);

    const rows = await db
      .select({
        brandId: educationAward.brandId,
        winnerName: educationAward.winnerName,
      })
      .from(educationAward)
      .where(
        and(
          eq(educationAward.period, period),
          inArray(educationAward.brandId, brandIds),
          isNotNull(educationAward.winnerUserId),
        ),
      );

    return rows.map((r) => ({
      brandId: r.brandId,
      brandName: nameByBrand.get(r.brandId) ?? "Brand",
      period,
      winnerName: r.winnerName,
    }));
  });

/**
 * The period key for the calendar month BEFORE the one `nowMs` falls in
 * (`"YYYY-MM"`, UTC). Pure; takes `nowMs` so the clock stays the single source of
 * "now", mirroring `currentPeriod`. January wraps to the prior December.
 */
function priorPeriod(nowMs: number): string {
  const d = new Date(nowMs);
  return currentPeriod(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}
