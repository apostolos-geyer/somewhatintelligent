/**
 * Gated analytics READ surface. This module only ever READS the append-only
 * `analytics_events` stream — it NEVER writes/updates/deletes (writes go through
 * `emitEvent` in lib/analytics.ts; the stream is the immutable source of truth,
 * §02 §12). `brand_id` is the verified envelope's `activeOrgId` — NEVER from
 * input (the tenancy invariant). Mirrors the gated-GET pattern in
 * `brand.functions.ts` / `quiz/courses.functions.ts`.
 *
 * P1 ships a minimal, real rollup: counts-by-type for one actor or the whole
 * brand, over an optional `[since, until)` window. The query rides the
 * `analytics_events_brand_actor_idx` (brand_id, actor_id, created_at) when an
 * actor is given, else `analytics_events_brand_type_idx` (brand_id, type,
 * created_at). The aggregation math is extracted into the pure `rollupEvents`
 * helper so it is unit-testable without a D1 harness.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, ne, sql, type SQL } from "drizzle-orm";
import type { AnalyticsEventType } from "@/lib/analytics";
import { rollupEvents, type RollupEvent, type TypeCount } from "@/lib/analytics-rollup";
import { createDb } from "@/lib/db";
import { resolveMemberNames } from "@/lib/member-names";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { analyticsEvents, decks, products } from "@/schema";

/** The minimal per-phase report: a total + per-type breakdown over a window. */
export interface BudtenderReport {
  brandId: string;
  /** The actor this report is scoped to, or null for a whole-brand rollup. */
  actorId: string | null;
  /** Inclusive lower bound (ms epoch) applied, or null for all-time. */
  since: number | null;
  /** Exclusive upper bound (ms epoch) applied, or null for unbounded. */
  until: number | null;
  /** Total events counted in the window. */
  total: number;
  /** Per-type counts, descending by count then ascending by type. */
  byType: TypeCount[];
}

/**
 * Input is window/actor only — there is NO brandId field by construction, so a
 * client cannot widen its scope. `actorId` omitted → whole-brand rollup. The
 * `arktype` validators mirror the `string >= 1` / numeric conventions used in
 * the other server fns.
 */
const getBudtenderReportInput = type({
  "actorId?": "string >= 1",
  "since?": "number >= 0",
  "until?": "number >= 0",
});

/**
 * Gated read of the caller's brand engagement rollup. `brand_id` is the
 * envelope's `activeOrgId` (NEVER input). Returns an empty report (total 0)
 * when the caller has no active org rather than throwing — the dashboard
 * renders an empty state.
 */
export const getBudtenderReport = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(getBudtenderReportInput)
  .handler(async ({ data, context }): Promise<BudtenderReport> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = data.actorId ?? null;
    const since = data.since ?? null;
    const until = data.until ?? null;

    // A self-read (actorId omitted, or equal to the caller's own id) is allowed
    // for any brand-audience member. Reading SOMEONE ELSE's actorId is a
    // management view — require Brand-Admin (owner|admin in the brand's BA org,
    // or platform admin) or hard-reject. Unlike a self-read this must NOT degrade
    // to a silent empty result.
    if (actorId !== null && actorId !== context.principal.actor.id) {
      await assertBrandAdmin(brandId, context.principal.actor.role);
    }

    // Build the WHERE incrementally; brand_id is always the leading predicate so
    // the planner uses a brand_* covering index. Optional actor/window predicates
    // are appended only when supplied.
    const db = createDb(env.DB);
    const predicates = [eq(analyticsEvents.brandId, brandId)];
    if (actorId !== null) predicates.push(eq(analyticsEvents.actorId, actorId));
    if (since !== null) predicates.push(sql`${analyticsEvents.createdAt} >= ${since}`);
    if (until !== null) predicates.push(sql`${analyticsEvents.createdAt} < ${until}`);

    const rows = await db
      .select({
        type: analyticsEvents.type,
        actorId: analyticsEvents.actorId,
        createdAt: analyticsEvents.createdAt,
      })
      .from(analyticsEvents)
      .where(and(...predicates));

    const events: RollupEvent[] = rows.map((r) => ({
      type: r.type,
      actorId: r.actorId,
      createdAt: r.createdAt,
    }));

    const { total, byType } = rollupEvents(events);
    return { brandId, actorId, since, until, total, byType };
  });

/** Re-export the closed event vocab so report consumers share one source. */
export type { AnalyticsEventType };

// ─── P6.A — Brand-Admin analytics dashboards ────────────────────────────────
//
// Every export below is the ADMIN read surface (P6.A) + the CSV export (P6.B).
// They all gate IN-HANDLER on `assertBrandAdmin` (owner|admin in the brand's BA
// org, or platform admin) — a plain budtender can read their OWN rollup via
// `getBudtenderReport` above, but the per-budtender matrix / per-deck / per-quiz
// breakdowns are management views. brand_id is ALWAYS the verified envelope's
// `activeOrgId`, NEVER input (the tenancy invariant). These are all READS — they
// aggregate `analytics_events` (the immutable source of truth) with GROUP BY over
// the brand_*/target indexes, and read the cheap denormalized counters
// (download_count, impressions/clicks) where they already exist. No write ever
// touches `analytics_events`.

/** Optional `[since, until)` window shared by every admin analytics input. */
const windowInput = type({
  "since?": "number >= 0",
  "until?": "number >= 0",
});

/**
 * Build the brand-scoped `[since, until)` window predicate for a column as a
 * Drizzle `sql` fragment. brand_id is bound separately by the caller; this
 * appends the optional created-at bounds against `col` so a query can window any
 * timestamp column (analytics_events.created_at, attempts.submitted_at,
 * ai_qa_log.created_at). `col` is a trusted internal SQL identifier (never user
 * input) — interpolated via `sql.raw`; the bound values ride parameter binds.
 */
function windowClause(col: string, since: number | null, until: number | null): SQL {
  const parts: SQL[] = [];
  if (since !== null) parts.push(sql`AND ${sql.raw(col)} >= ${since}`);
  if (until !== null) parts.push(sql`AND ${sql.raw(col)} < ${until}`);
  return parts.length ? sql` ${sql.join(parts, sql` `)}` : sql``;
}

// ─── getBudtenderMatrix — per-budtender engagement rollup ────────────────────

/** One budtender's cross-domain engagement counts + composite rank. */
export interface BudtenderMatrixRow {
  actorId: string;
  /** Resolved display name (guestlist org member); null if unresolved. */
  name: string | null;
  deckOpens: number;
  quizSubmits: number;
  productViews: number;
  reviews: number;
  feedPosts: number;
  sessionJoins: number;
  downloads: number;
  physicalRequests: number;
  aiQuestions: number;
  chatMessages: number;
  certs: number;
  /** Total events across every type (the matrix's headline number). */
  total: number;
  /** 1-based composite rank by `total` (ties share the dense rank). */
  rank: number;
}

export interface BudtenderMatrix {
  brandId: string;
  since: number | null;
  until: number | null;
  rows: BudtenderMatrixRow[];
}

/** The event types that fold into each matrix column (closed vocab, §02 §12). */
const MATRIX_TYPE_COLUMN: Record<string, keyof BudtenderMatrixRow> = {
  deck_open: "deckOpens",
  quiz_attempt_submit: "quizSubmits",
  product_view: "productViews",
  review_left: "reviews",
  post_view: "feedPosts", // authored-feed engagement; post_like folds in below
  post_like: "feedPosts",
  session_join: "sessionJoins",
  asset_download: "downloads",
  deck_download: "downloads",
  physical_request: "physicalRequests",
  ai_question: "aiQuestions",
  chat_message: "chatMessages",
  cert_awarded: "certs",
};

/**
 * Admin: the per-budtender engagement matrix — one row per actor with their
 * cross-domain counts (decks/quizzes/products/reviews/feed/sessions/downloads/
 * requests/AI/chat + certs), the row total, and a dense composite rank by total.
 * Reads `analytics_events` grouped by (actor_id, type) over the optional window;
 * `cert_awarded` doubles as the cert count. brand = envelope `activeOrgId`, never
 * input. No active org → empty matrix.
 */
/**
 * The matrix's row build, factored out so `getBudtenderMatrix` AND `exportCsv`
 * share ONE query — the CSV and the on-screen table can never drift. Caller has
 * already resolved `brandId` + asserted Brand-Admin.
 */
async function getBudtenderMatrixRows(
  brandId: string,
  since: number | null,
  until: number | null,
): Promise<BudtenderMatrixRow[]> {
  const db = createDb(env.DB);
  const win = windowClause("created_at", since, until);
  const result = await db.all<{ actor_id: string; type: string; n: number }>(
    sql`SELECT actor_id, type, COUNT(*) AS n
       FROM analytics_events
      WHERE brand_id = ${brandId}${win}
      GROUP BY actor_id, type`,
  );

  const byActor = new Map<string, BudtenderMatrixRow>();
  const blank = (actorId: string): BudtenderMatrixRow => ({
    actorId,
    name: null,
    deckOpens: 0,
    quizSubmits: 0,
    productViews: 0,
    reviews: 0,
    feedPosts: 0,
    sessionJoins: 0,
    downloads: 0,
    physicalRequests: 0,
    aiQuestions: 0,
    chatMessages: 0,
    certs: 0,
    total: 0,
    rank: 0,
  });

  for (const r of result) {
    const row = byActor.get(r.actor_id) ?? blank(r.actor_id);
    const col = MATRIX_TYPE_COLUMN[r.type];
    if (col && col !== "actorId" && col !== "rank") {
      (row[col] as number) += r.n;
    }
    row.total += r.n;
    byActor.set(r.actor_id, row);
  }

  // Resolve actor ids → display names (guestlist org members) so the matrix and
  // CSV show "Alex T." not a raw id. Degrades to ids on any lookup failure.
  const names = await resolveMemberNames(brandId);
  for (const row of byActor.values()) row.name = names.get(row.actorId) ?? null;

  // Sort by total desc (ties broken by actorId for stability), then assign a
  // dense rank so equal totals share a rank.
  const rows = [...byActor.values()].sort(
    (a, b) => b.total - a.total || a.actorId.localeCompare(b.actorId),
  );
  let rank = 0;
  let prevTotal: number | null = null;
  for (const row of rows) {
    if (prevTotal === null || row.total !== prevTotal) {
      rank += 1;
      prevTotal = row.total;
    }
    row.rank = rank;
  }
  return rows;
}

export const getBudtenderMatrix = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(windowInput)
  .handler(async ({ data, context }): Promise<BudtenderMatrix> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const since = data.since ?? null;
    const until = data.until ?? null;
    await assertBrandAdmin(brandId, context.principal.actor.role);
    const rows = await getBudtenderMatrixRows(brandId, since, until);
    return { brandId, since, until, rows };
  });

// ─── getDeckStats — per-deck opens / flip / downloads ───────────────────────

/** One deck's engagement: opens, avg flip-time, deepest page reached, downloads. */
export interface DeckStatsRow {
  deckId: string;
  title: string;
  pageCount: number;
  /** Distinct `deck_open` events over the window. */
  opens: number;
  /** Distinct `deck_flip` events over the window (the flip volume). */
  flips: number;
  /** Mean `time_spent_seconds` across readers with progress (0 when none). */
  avgFlipSeconds: number;
  /** Deepest `last_page` any reader reached (the high-water mark). */
  lastPageReached: number;
  /** `decks.download_count`-equivalent: `deck_download` events over the window. */
  downloads: number;
}

export interface DeckStats {
  brandId: string;
  since: number | null;
  until: number | null;
  rows: DeckStatsRow[];
}

/**
 * Per-deck rows, shared by `getDeckStats` + `exportCsv` (ONE query so the CSV and
 * the dashboard table never drift). Opens/flips/downloads come from
 * `analytics_events` (grouped by target_id over the window, target_type='deck');
 * avg flip-time + the deepest page come from the `deck_progress` denormalized
 * state (all-time — the progress row IS the high-water mark, it carries no
 * per-event timestamp). Caller has resolved `brandId` + asserted Brand-Admin.
 */
async function getDeckStatsRows(
  brandId: string,
  since: number | null,
  until: number | null,
): Promise<DeckStatsRow[]> {
  const db = createDb(env.DB);
  const win = windowClause("created_at", since, until);
  const [decksRes, eventsRes, progressRes] = await Promise.all([
    db
      .select({ id: decks.id, title: decks.title, pageCount: decks.pageCount })
      .from(decks)
      .where(eq(decks.brandId, brandId))
      .orderBy(desc(decks.createdAt), desc(decks.id)),
    db.all<{ target_id: string; type: string; n: number }>(
      sql`SELECT target_id, type, COUNT(*) AS n
         FROM analytics_events
        WHERE brand_id = ${brandId} AND target_type = 'deck'
          AND type IN ('deck_open', 'deck_flip', 'deck_download')${win}
        GROUP BY target_id, type`,
    ),
    db.all<{ deck_id: string; avg_secs: number | null; max_page: number | null }>(
      sql`SELECT deck_id,
              AVG(time_spent_seconds) AS avg_secs,
              MAX(last_page) AS max_page
         FROM deck_progress
        WHERE brand_id = ${brandId}
        GROUP BY deck_id`,
    ),
  ]);

  const events = new Map<string, { opens: number; flips: number; downloads: number }>();
  for (const e of eventsRes) {
    const slot = events.get(e.target_id) ?? { opens: 0, flips: 0, downloads: 0 };
    if (e.type === "deck_open") slot.opens += e.n;
    else if (e.type === "deck_flip") slot.flips += e.n;
    else if (e.type === "deck_download") slot.downloads += e.n;
    events.set(e.target_id, slot);
  }
  const progress = new Map(
    progressRes.map((p) => [
      p.deck_id,
      { avg: Math.round(p.avg_secs ?? 0), maxPage: p.max_page ?? 0 },
    ]),
  );

  return decksRes.map((d) => {
    const e = events.get(d.id) ?? { opens: 0, flips: 0, downloads: 0 };
    const p = progress.get(d.id) ?? { avg: 0, maxPage: 0 };
    return {
      deckId: d.id,
      title: d.title,
      pageCount: d.pageCount,
      opens: e.opens,
      flips: e.flips,
      avgFlipSeconds: p.avg,
      lastPageReached: p.maxPage,
      downloads: e.downloads,
    };
  });
}

/**
 * Admin: per-deck engagement (opens / avg flip-time / deepest page / downloads).
 * brand = envelope `activeOrgId`, never input. No active org → empty.
 */
export const getDeckStats = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(windowInput)
  .handler(async ({ data, context }): Promise<DeckStats> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const since = data.since ?? null;
    const until = data.until ?? null;
    await assertBrandAdmin(brandId, context.principal.actor.role);
    const rows = await getDeckStatsRows(brandId, since, until);
    return { brandId, since, until, rows };
  });

// ─── getProductStats — per-product views / reviews / avg-stars ──────────────

/** One product's engagement: views over the window + its review aggregate. */
export interface ProductStatsRow {
  productId: string;
  name: string;
  category: string;
  /** `product_view` events over the window. */
  views: number;
  /** Count of reviews (all-time — `reviews` is the durable aggregate). */
  reviewCount: number;
  /** Mean star rating across reviews (0 when none), rounded to 1 dp. */
  avgStars: number;
}

export interface ProductStats {
  brandId: string;
  since: number | null;
  until: number | null;
  rows: ProductStatsRow[];
}

/**
 * Admin: per-product engagement. Views come from `analytics_events`
 * (target_type='product') over the window; review count + average stars come from
 * the durable `reviews` table (all-time aggregate). brand = envelope
 * `activeOrgId`, never input.
 */
/** Per-product rows, shared by `getProductStats` + `exportCsv`. */
async function getProductStatsRows(
  brandId: string,
  since: number | null,
  until: number | null,
): Promise<ProductStatsRow[]> {
  const db = createDb(env.DB);
  const win = windowClause("created_at", since, until);
  const [productsRes, viewsRes, reviewsRes] = await Promise.all([
    db
      .select({ id: products.id, name: products.name, category: products.category })
      .from(products)
      .where(and(eq(products.brandId, brandId), ne(products.status, "archived")))
      .orderBy(asc(products.orderIdx), desc(products.createdAt), desc(products.id)),
    db.all<{ target_id: string; n: number }>(
      sql`SELECT target_id, COUNT(*) AS n
         FROM analytics_events
        WHERE brand_id = ${brandId} AND target_type = 'product' AND type = 'product_view'${win}
        GROUP BY target_id`,
    ),
    db.all<{ product_id: string; n: number; avg_rating: number | null }>(
      sql`SELECT product_id, COUNT(*) AS n, AVG(rating) AS avg_rating
         FROM reviews WHERE brand_id = ${brandId} GROUP BY product_id`,
    ),
  ]);

  const views = new Map(viewsRes.map((v) => [v.target_id, v.n]));
  const reviews = new Map(
    reviewsRes.map((r) => [
      r.product_id,
      { count: r.n, avg: Math.round((r.avg_rating ?? 0) * 10) / 10 },
    ]),
  );

  return productsRes.map((p) => {
    const r = reviews.get(p.id) ?? { count: 0, avg: 0 };
    return {
      productId: p.id,
      name: p.name,
      // `products.category` is a nullable column; the raw-D1 row generic asserted
      // a non-null `string`, so we preserve that exact pass-through behaviour.
      category: p.category as string,
      views: views.get(p.id) ?? 0,
      reviewCount: r.count,
      avgStars: r.avg,
    };
  });
}

/**
 * Admin: per-product engagement (views over the window + the all-time review
 * count + average stars). brand = envelope `activeOrgId`, never input.
 */
export const getProductStats = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(windowInput)
  .handler(async ({ data, context }): Promise<ProductStats> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const since = data.since ?? null;
    const until = data.until ?? null;
    await assertBrandAdmin(brandId, context.principal.actor.role);
    const rows = await getProductStatsRows(brandId, since, until);
    return { brandId, since, until, rows };
  });

// ─── getQuizStats — completion-rate / avg-grade / most-missed ───────────────

/** One quiz's outcome aggregate + its single most-missed question. */
export interface QuizStatsRow {
  quizId: string;
  title: string;
  /** Submitted attempts over the window (the denominator). */
  attempts: number;
  /** Passed / submitted as a 0–100 percentage (0 when no attempts). */
  completionRate: number;
  /** Mean (score / max_score) as a 0–100 percentage across submitted attempts. */
  avgGradePercent: number;
  /** The prompt of the question missed most often, or null when none recorded. */
  mostMissedPrompt: string | null;
  /** How many graded answers got that question wrong (0 when none). */
  mostMissedWrongCount: number;
}

export interface QuizStats {
  brandId: string;
  since: number | null;
  until: number | null;
  rows: QuizStatsRow[];
}

/**
 * Admin: per-quiz outcomes. Attempts/completion/avg-grade come from `attempts`
 * (submitted, windowed on `submitted_at`); the MOST-MISSED question is the
 * question with the most `attempt_answers.is_correct = 0` rows across this brand's
 * submitted attempts (joined to `questions` for its prompt). Computed in the read
 * fn (no precompute job) — the join rides the `attempt_answers_attempt_idx` +
 * `attempts_brand_submitted_idx`. brand = envelope `activeOrgId`, never input.
 */
/**
 * Per-quiz rows, shared by `getQuizStats` + `exportCsv`. Attempts/completion/
 * avg-grade come from `attempts` (submitted, windowed on `submitted_at`); the
 * MOST-MISSED question is the one with the most `attempt_answers.is_correct = 0`
 * rows across this brand's submitted attempts (joined to `questions` for its
 * prompt). Computed in the read fn (no precompute job) — the join rides
 * `attempt_answers_attempt_idx` + `attempts_brand_submitted_idx`.
 */
async function getQuizStatsRows(
  brandId: string,
  since: number | null,
  until: number | null,
): Promise<QuizStatsRow[]> {
  const db = createDb(env.DB);
  const win = windowClause("a.submitted_at", since, until);
  const [quizzesRes, missedRes] = await Promise.all([
    db.all<{
      quiz_id: string;
      title: string;
      attempts: number;
      passes: number | null;
      avg_frac: number | null;
    }>(
      sql`SELECT z.id AS quiz_id, z.title AS title,
              COUNT(a.id) AS attempts,
              SUM(CASE WHEN a.passed = 1 THEN 1 ELSE 0 END) AS passes,
              AVG(CASE WHEN a.max_score > 0 THEN a.score * 1.0 / a.max_score ELSE 0 END) AS avg_frac
         FROM quizzes z
         LEFT JOIN attempts a
           ON a.quiz_id = z.id AND a.status = 'submitted'${win}
        WHERE z.brand_id = ${brandId}
        GROUP BY z.id
        ORDER BY z.created_at DESC, z.id DESC`,
    ),
    // Most-missed: per quiz, the question with the most wrong graded answers.
    db.all<{ quiz_id: string; question_id: string; prompt: string; wrong: number }>(
      sql`SELECT a.quiz_id AS quiz_id, ans.question_id AS question_id,
              q.prompt AS prompt, COUNT(*) AS wrong
         FROM attempt_answers ans
         INNER JOIN attempts a ON a.id = ans.attempt_id
         INNER JOIN questions q ON q.id = ans.question_id
        WHERE a.brand_id = ${brandId} AND a.status = 'submitted'
          AND ans.is_correct = 0${win}
        GROUP BY a.quiz_id, ans.question_id
        ORDER BY a.quiz_id ASC, wrong DESC, ans.question_id ASC`,
    ),
  ]);

  // First row per quiz_id is its most-missed (ordered wrong DESC above).
  const mostMissed = new Map<string, { prompt: string; wrong: number }>();
  for (const m of missedRes) {
    if (!mostMissed.has(m.quiz_id)) {
      mostMissed.set(m.quiz_id, { prompt: m.prompt, wrong: m.wrong });
    }
  }

  return quizzesRes.map((r) => {
    const attempts = r.attempts ?? 0;
    const passes = r.passes ?? 0;
    const missed = mostMissed.get(r.quiz_id);
    return {
      quizId: r.quiz_id,
      title: r.title,
      attempts,
      completionRate: attempts > 0 ? Math.round((passes / attempts) * 100) : 0,
      avgGradePercent: Math.round((r.avg_frac ?? 0) * 100),
      mostMissedPrompt: missed?.prompt ?? null,
      mostMissedWrongCount: missed?.wrong ?? 0,
    };
  });
}

/**
 * Admin: per-quiz outcomes (completion-rate / avg-grade / most-missed question).
 * brand = envelope `activeOrgId`, never input.
 */
export const getQuizStats = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(windowInput)
  .handler(async ({ data, context }): Promise<QuizStats> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const since = data.since ?? null;
    const until = data.until ?? null;
    await assertBrandAdmin(brandId, context.principal.actor.role);
    const rows = await getQuizStatsRows(brandId, since, until);
    return { brandId, since, until, rows };
  });

// ─── getAiQuestionStats — top AI questions ──────────────────────────────────

/** One distinct AI question (normalized) + how many times it was asked. */
export interface AiQuestionStatsRow {
  /** The question text (first-seen casing of the normalized key). */
  question: string;
  count: number;
  /** True when the assistant had no grounding match (source IS NULL / 'none'). */
  unanswered: boolean;
}

export interface AiQuestionStats {
  brandId: string;
  since: number | null;
  until: number | null;
  rows: AiQuestionStatsRow[];
}

const aiStatsInput = type({
  "since?": "number >= 0",
  "until?": "number >= 0",
  "limit?": "number >= 1",
});

/**
 * Top-N AI question rows, shared by `getAiQuestionStats` + `exportCsv`. Reads
 * `ai_qa_log` over the window, groups by a lowercased/trimmed question key so
 * trivial casing/whitespace variants collapse, and returns the most-asked first
 * (capped at `limit`). A question whose every logged turn had no grounding match
 * (source NULL / 'none') is flagged `unanswered` — those are the custom-Q&A gaps.
 */
async function getAiQuestionStatsRows(
  brandId: string,
  since: number | null,
  until: number | null,
  limit: number,
): Promise<AiQuestionStatsRow[]> {
  const db = createDb(env.DB);
  const win = windowClause("created_at", since, until);
  const result = await db.all<{ qkey: string; sample: string; n: number; misses: number }>(
    sql`SELECT LOWER(TRIM(question)) AS qkey,
            MIN(question) AS sample,
            COUNT(*) AS n,
            SUM(CASE WHEN source IS NULL OR source = 'none' THEN 1 ELSE 0 END) AS misses
       FROM ai_qa_log
      WHERE brand_id = ${brandId}${win}
      GROUP BY qkey
      ORDER BY n DESC, qkey ASC
      LIMIT ${limit}`,
  );

  return result.map((r) => ({
    question: r.sample,
    count: r.n,
    unanswered: r.misses === r.n, // every logged turn missed → a grounding gap
  }));
}

/**
 * Admin: the TOP budtender-asked AI questions (default 20, capped by `limit`).
 * brand = envelope `activeOrgId`, never input.
 */
export const getAiQuestionStats = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(aiStatsInput)
  .handler(async ({ data, context }): Promise<AiQuestionStats> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const since = data.since ?? null;
    const until = data.until ?? null;
    const limit = data.limit ?? 20;
    await assertBrandAdmin(brandId, context.principal.actor.role);
    const rows = await getAiQuestionStatsRows(brandId, since, until, limit);
    return { brandId, since, until, rows };
  });

// ─── exportCsv — brand-scoped CSV export (P6.B) ─────────────────────────────

/** The closed set of CSV export views (1:1 with the dashboard tabs). */
export const CSV_VIEWS = ["budtenders", "decks", "products", "quizzes", "ai_questions"] as const;
export type CsvView = (typeof CSV_VIEWS)[number];

const exportCsvInput = type({
  view: "'budtenders' | 'decks' | 'products' | 'quizzes' | 'ai_questions'",
  "since?": "number >= 0",
  "until?": "number >= 0",
});

/** RFC-4180 field escaping: quote when the value holds a comma/quote/newline. */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Join a 2-D string/number grid into a CRLF-terminated CSV body. */
function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/**
 * Admin: stream a brand-scoped CSV for one dashboard `view` over the optional
 * window. Returns a raw `Response` (text/csv; attachment) — TSS passes a handler's
 * `Response` through verbatim, so the browser receives a real downloadable file.
 * Each view reuses the SAME aggregate the dashboard reads, so the CSV and the
 * on-screen table never drift. brand = envelope `activeOrgId`, never input —
 * the export is ALWAYS scoped to the caller's own brand (P6.B: Brand-Admin CSV is
 * brand-scoped; the Sprout-Admin god-mode export is a separate stream).
 */
export const exportCsv = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(exportCsvInput)
  .handler(async ({ data, context }): Promise<Response> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const since = data.since ?? null;
    const until = data.until ?? null;
    const grid: Array<Array<string | number>> = [];

    if (data.view === "budtenders") {
      const m = await getBudtenderMatrixRows(brandId, since, until);
      grid.push([
        "actor_id",
        "rank",
        "total",
        "deck_opens",
        "quiz_submits",
        "product_views",
        "reviews",
        "feed",
        "session_joins",
        "downloads",
        "physical_requests",
        "ai_questions",
        "chat_messages",
        "certs",
      ]);
      for (const r of m) {
        grid.push([
          r.actorId,
          r.rank,
          r.total,
          r.deckOpens,
          r.quizSubmits,
          r.productViews,
          r.reviews,
          r.feedPosts,
          r.sessionJoins,
          r.downloads,
          r.physicalRequests,
          r.aiQuestions,
          r.chatMessages,
          r.certs,
        ]);
      }
    } else if (data.view === "decks") {
      const rows = await getDeckStatsRows(brandId, since, until);
      grid.push([
        "deck_id",
        "title",
        "page_count",
        "opens",
        "flips",
        "avg_flip_seconds",
        "last_page_reached",
        "downloads",
      ]);
      for (const r of rows) {
        grid.push([
          r.deckId,
          r.title,
          r.pageCount,
          r.opens,
          r.flips,
          r.avgFlipSeconds,
          r.lastPageReached,
          r.downloads,
        ]);
      }
    } else if (data.view === "products") {
      const rows = await getProductStatsRows(brandId, since, until);
      grid.push(["product_id", "name", "category", "views", "review_count", "avg_stars"]);
      for (const r of rows) {
        grid.push([r.productId, r.name, r.category, r.views, r.reviewCount, r.avgStars]);
      }
    } else if (data.view === "quizzes") {
      const rows = await getQuizStatsRows(brandId, since, until);
      grid.push([
        "quiz_id",
        "title",
        "attempts",
        "completion_rate_pct",
        "avg_grade_pct",
        "most_missed_question",
        "most_missed_wrong_count",
      ]);
      for (const r of rows) {
        grid.push([
          r.quizId,
          r.title,
          r.attempts,
          r.completionRate,
          r.avgGradePercent,
          r.mostMissedPrompt ?? "",
          r.mostMissedWrongCount,
        ]);
      }
    } else {
      const rows = await getAiQuestionStatsRows(brandId, since, until, 1000);
      grid.push(["question", "count", "unanswered"]);
      for (const r of rows) {
        grid.push([r.question, r.count, r.unanswered ? "1" : "0"]);
      }
    }

    const csv = `${toCsv(grid)}\r\n`;
    const stamp = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sprout-${data.view}-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  });
