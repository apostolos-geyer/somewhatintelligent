/**
 * Sprout `scheduled` handler. The leaderboard recompute lives here — this is the
 * ONE place the composite-score math (`computeScore` / `SCORE_WEIGHTS`) runs, so
 * leaderboard reads (`getLeaderboard`) only ever sort the materialized
 * `user_brand_scores` snapshot, never scan live. Each pass stays idempotent +
 * cheap (the `scheduled` wall-clock budget is small): a re-run for the same period
 * UPSERTs the same rows.
 *
 * Param types stay `unknown` to match the kit's structural scheduled-handler
 * shape; `env` is read from `cloudflare:workers` (the worker entry never reads it
 * at module top level — bundle-leakage constraint), so the bound `_env` arg is
 * ignored here.
 *
 * Passes wired here (each idempotent + cheap):
 *   - leaderboard recompute      → materialize the period's user_brand_scores.
 *   - session lifecycle          → flip scheduled → live → ended for sessions
 *                                  whose start/end times have passed.
 *   - award close (P5.B)         → at period close, stamp the prior period's top
 *                                  user_brand_scores row into education_award.
 *                                  winner_* and notify the winner (education-fund
 *                                  framing). Guarded on winner_user_id IS NULL.
 *
 * Later phases extend this single entry point (keep each pass idempotent + cheap):
 *   - org_brand_directory reconcile → resync the public directory projection.
 */
import { env } from "cloudflare:workers";
import { and, asc, count, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import {
  bookings,
  decks,
  educationAward,
  groupSessions,
  quizzes,
  sessionAttendance,
  userBrandScores,
} from "@/schema";
import { computeScore, currentPeriod } from "@/lib/score";
import { emitNotification } from "@/lib/notify";
import { archiveRecording } from "@/lib/realtime";

/** The [start, end) epoch-ms bounds of the UTC month a period key names. */
function periodBounds(period: string): { startMs: number; endMs: number } {
  const [y, m] = period.split("-").map(Number);
  const startMs = Date.UTC(y, m - 1, 1);
  const endMs = Date.UTC(y, m, 1); // first ms of the next month (exclusive)
  return { startMs, endMs };
}

/**
 * The period key for the calendar month BEFORE the one `nowMs` falls in
 * (`"YYYY-MM"`, UTC) — the "just-closed" period the award pass settles. January
 * wraps to the prior December. Pure; takes `nowMs` so the cron's clock stays the
 * single source of "now", mirroring `currentPeriod`.
 */
function priorPeriod(nowMs: number): string {
  const d = new Date(nowMs);
  return currentPeriod(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
}

/**
 * Until guestlist names resolve (a later phase), a winner's name is a short,
 * stable, SEMI-ANONYMOUS handle off the user id — the same convention the
 * leaderboard table renders. Keeps the award strip identity-light by design.
 */
function winnerHandle(userId: string): string {
  return userId.length <= 8 ? userId : `${userId.slice(0, 8)}…`;
}

// ── Row projections (snake_case from D1, narrowed by hand) ───────────────────

/** Distinct (brand, user) pairs with any scoring activity in the period. */
interface ActorRow {
  brand_id: string;
  user_id: string;
}

/** Best passing grade fraction per quiz for one (brand, user) in the period. */
interface QuizGradeRow {
  best_grade: number;
}

interface DeckStatsRow {
  completed_decks: number;
  total_time: number;
}

/**
 * Recompute every (brand, user) score row for the period. Gathers the distinct
 * actors with activity this period (passing attempts OR deck progress, brand-
 * scoped — `brand_id` must be non-null), then per actor projects the three score
 * inputs and UPSERTs `user_brand_scores`. Activity-engagement signals (posts /
 * sessions / chat) land in P3/P4; their tables don't exist yet, so they read as 0.
 */
async function recomputeLeaderboard(nowMs: number): Promise<{ rows: number }> {
  const period = currentPeriod(nowMs);
  const { startMs, endMs } = periodBounds(period);
  const db = createDb(env.DB);

  // Per-brand published denominators (counts, not period-scoped — a brand's
  // catalogue is the denominator). Built once and reused across that brand's users.
  const publishedQuizCache = new Map<string, number>();
  const publishedDeckCache = new Map<string, number>();

  async function publishedQuizzes(brandId: string): Promise<number> {
    const cached = publishedQuizCache.get(brandId);
    if (cached !== undefined) return cached;
    const row = (
      await db
        .select({ n: count() })
        .from(quizzes)
        .where(and(eq(quizzes.brandId, brandId), eq(quizzes.status, "published")))
    ).at(0);
    const n = row?.n ?? 0;
    publishedQuizCache.set(brandId, n);
    return n;
  }

  async function publishedDecks(brandId: string): Promise<number> {
    const cached = publishedDeckCache.get(brandId);
    if (cached !== undefined) return cached;
    const row = (
      await db
        .select({ n: count() })
        .from(decks)
        .where(and(eq(decks.brandId, brandId), eq(decks.status, "published")))
    ).at(0);
    const n = row?.n ?? 0;
    publishedDeckCache.set(brandId, n);
    return n;
  }

  // Distinct (brand, user) with activity in the period. Submitted attempts use
  // submitted_at; deck progress uses updated_at. Both require a non-null brand —
  // public/platform quizzes (brand_id NULL) don't feed a brand leaderboard.
  const actors = await db.all<ActorRow>(
    sql`SELECT DISTINCT brand_id, user_id FROM (
        SELECT brand_id, user_id FROM attempts
          WHERE brand_id IS NOT NULL AND status = 'submitted'
            AND submitted_at >= ${startMs} AND submitted_at < ${endMs}
        UNION
        SELECT brand_id, user_id FROM deck_progress
          WHERE updated_at >= ${startMs} AND updated_at < ${endMs}
      )`,
  );

  let rows = 0;
  for (const actor of actors ?? []) {
    const { brand_id: brandId, user_id: userId } = actor;

    // Quiz: best passing grade fraction per quiz this period. A passing attempt
    // has passed != 0 and a positive max_score; grade = score / max_score. We
    // take the per-quiz max, then list those fractions.
    const grades = await db.all<QuizGradeRow>(
      sql`SELECT MAX(score * 1.0 / max_score) AS best_grade
         FROM attempts
        WHERE brand_id = ${brandId} AND user_id = ${userId} AND status = 'submitted'
          AND passed = 1 AND max_score > 0
          AND submitted_at >= ${startMs} AND submitted_at < ${endMs}
        GROUP BY quiz_id`,
    );
    const passingQuizGrades = (grades ?? [])
      .map((r) => r.best_grade)
      .filter((g): g is number => typeof g === "number" && Number.isFinite(g));

    // Deck: count of finished decks (last_page >= page_count) + total time. The
    // join to decks resolves page_count; a deck still processing (page_count 0)
    // can't be "completed" since last_page >= 1 > 0 would falsely qualify, so we
    // additionally require page_count > 0.
    const deckStats = (
      await db.all<DeckStatsRow>(
        sql`SELECT
          COALESCE(SUM(CASE WHEN d.page_count > 0 AND dp.last_page >= d.page_count THEN 1 ELSE 0 END), 0) AS completed_decks,
          COALESCE(SUM(dp.time_spent_seconds), 0) AS total_time
         FROM deck_progress dp
         JOIN decks d ON d.id = dp.deck_id
        WHERE dp.brand_id = ${brandId} AND dp.user_id = ${userId}
          AND dp.updated_at >= ${startMs} AND dp.updated_at < ${endMs}`,
      )
    ).at(0);

    const result = computeScore({
      passingQuizGrades,
      publishedQuizzes: await publishedQuizzes(brandId),
      completedDecks: deckStats?.completed_decks ?? 0,
      publishedDecks: await publishedDecks(brandId),
      totalDeckTimeSeconds: deckStats?.total_time ?? 0,
      // P3/P4 engagement signals — those tables don't exist yet; read as 0.
      comments: 0,
      postLikes: 0,
      sessionJoin: 0,
      sessionRegister: 0,
      chatMessage: 0,
    });

    // Idempotent UPSERT keyed on the (brand, user, period) unique index. A re-run
    // for the same period overwrites the score + components + computed_at.
    await db
      .insert(userBrandScores)
      .values({
        id: ulid(),
        brandId,
        userId,
        period,
        score: result.score,
        quizPoints: result.quizPoints,
        deckPoints: result.deckPoints,
        activityPoints: result.activityPoints,
        computedAt: nowMs,
      })
      .onConflictDoUpdate({
        target: [userBrandScores.brandId, userBrandScores.userId, userBrandScores.period],
        set: {
          score: result.score,
          quizPoints: result.quizPoints,
          deckPoints: result.deckPoints,
          activityPoints: result.activityPoints,
          computedAt: nowMs,
        },
      });
    rows++;
  }

  return { rows };
}

// ── P4.C — session lifecycle pass ────────────────────────────────────────────

/** How far ahead of a session's start a `session_reminder` is emitted (15 min). */
const REMINDER_LEAD_MS = 15 * 60_000;

/**
 * Advance the booking + group-session lifecycle around their scheduled times.
 * Idempotent + guarded (each transition is a status-scoped UPDATE, so a re-run is
 * a no-op):
 *
 *  - group_sessions: `scheduled → live` once now ≥ starts_at (and still before
 *    ends_at); `live → ended` once now ≥ ends_at. On the `ended` flip the
 *    recording is archived to roadie via `archiveRecording` (a documented stub —
 *    inert locally) and the resulting ref stamped into `recording_ref`.
 *  - bookings: `booked → completed` once now ≥ slot_ends_at.
 *  - session_reminder notifications: for sessions about to start (within
 *    REMINDER_LEAD_MS, still `scheduled` and not yet started) each registered
 *    attendee is notified. The schema carries no `reminded_at` column (frozen),
 *    so this is best-effort: a tighter cron cadence than REMINDER_LEAD_MS can
 *    re-notify within the lead window. Keeping the window narrow (and the
 *    `scheduled`-only filter, since the live-flip below leaves the window once a
 *    session starts) bounds the duplicates to the few ticks inside the lead.
 *
 * brand_id flows straight off each row (the cron has no caller envelope; this is
 * a system pass), and every notification/event still carries it for tenancy.
 */
async function advanceSessionLifecycle(nowMs: number): Promise<{
  toLive: number;
  toEnded: number;
  bookingsCompleted: number;
  reminders: number;
}> {
  const stats = { toLive: 0, toEnded: 0, bookingsCompleted: 0, reminders: 0 };
  const db = createDb(env.DB);

  // 1. Reminders for sessions starting soon (still scheduled, inside the lead
  //    window). Fired before the live-flip so each session reminds once.
  const upcoming = await db
    .select({
      id: groupSessions.id,
      brandId: groupSessions.brandId,
      startsAt: groupSessions.startsAt,
      endsAt: groupSessions.endsAt,
      status: groupSessions.status,
      realtimeSessionId: groupSessions.realtimeSessionId,
      recordingRef: groupSessions.recordingRef,
    })
    .from(groupSessions)
    .where(
      and(
        eq(groupSessions.status, "scheduled"),
        sql`${groupSessions.startsAt} > ${nowMs}`,
        lte(groupSessions.startsAt, nowMs + REMINDER_LEAD_MS),
      ),
    );
  for (const session of upcoming) {
    const attendees = await db
      .select({ userId: sessionAttendance.userId })
      .from(sessionAttendance)
      .where(eq(sessionAttendance.sessionId, session.id));
    for (const a of attendees) {
      await emitNotification({
        brandId: session.brandId,
        userId: a.userId,
        type: "session_reminder",
        title: "Your session starts soon",
        body: "A group session you registered for is about to begin.",
        refType: "group_session",
        refId: session.id,
      });
      stats.reminders++;
    }
  }

  // 2. scheduled → live (now within the session window). Status-scoped, idempotent.
  const liveRes = await db
    .update(groupSessions)
    .set({ status: "live" })
    .where(
      and(
        eq(groupSessions.status, "scheduled"),
        lte(groupSessions.startsAt, nowMs),
        sql`${groupSessions.endsAt} > ${nowMs}`,
      ),
    );
  stats.toLive = liveRes.meta.changes ?? 0;

  // 3. live|scheduled → ended (past the end). A session that never went live (the
  //    pass skipped its window) still ends. Archive recording on the flip.
  const toEnd = await db
    .select({
      id: groupSessions.id,
      brandId: groupSessions.brandId,
      startsAt: groupSessions.startsAt,
      endsAt: groupSessions.endsAt,
      status: groupSessions.status,
      realtimeSessionId: groupSessions.realtimeSessionId,
      recordingRef: groupSessions.recordingRef,
    })
    .from(groupSessions)
    .where(
      and(inArray(groupSessions.status, ["scheduled", "live"]), lte(groupSessions.endsAt, nowMs)),
    );
  for (const session of toEnd) {
    // Archive the recording (stub → inert locally) before flipping to ended.
    let recordingRef = session.recordingRef;
    if (!recordingRef && session.realtimeSessionId) {
      try {
        const archived = await archiveRecording(session.realtimeSessionId);
        if (archived.available) recordingRef = archived.recordingRef;
      } catch {
        // archive failure must never block the ended transition.
      }
    }
    const endRes = await db
      .update(groupSessions)
      .set({ status: "ended", recordingRef })
      .where(
        and(eq(groupSessions.id, session.id), inArray(groupSessions.status, ["scheduled", "live"])),
      );
    stats.toEnded += endRes.meta.changes ?? 0;
  }

  // 4. bookings booked → completed (slot fully elapsed). Status-scoped, idempotent.
  const completedRes = await db
    .update(bookings)
    .set({ status: "completed" })
    .where(and(eq(bookings.status, "booked"), lte(bookings.slotEndsAt, nowMs)));
  stats.bookingsCompleted = completedRes.meta.changes ?? 0;

  return stats;
}

// ── P5.B — education-award close pass ────────────────────────────────────────

/**
 * Settle the EDUCATION-AWARD windows that have closed: snapshot the period's top
 * budtender into `education_award.winner_*` and notify them. Scoped to the PRIOR
 * period (the just-closed month) so a still-open current window is never frozen
 * early; the per-row `closes_at <= now` check is a second guard for windows that
 * close off the calendar boundary.
 *
 * Idempotent + guarded: only rows with `winner_user_id IS NULL` are considered,
 * and the UPDATE re-asserts that guard, so a re-run after a winner is stamped is a
 * pure no-op (no second notification). A window with no scores this period stays
 * un-stamped (nothing to award) until a score lands — never errors. This pass
 * never CREATES award rows (the fund/closes_at are an admin concern, frozen
 * schema); it only fills the winner once a window's row exists and has closed.
 *
 * The winner's name is the semi-anonymous handle (`winnerHandle`) — the framing is
 * an EDUCATION FUND, never a prize/reward/cash (product law); the notification copy
 * holds to that.
 */
async function closeAwardWindows(nowMs: number): Promise<{ awarded: number }> {
  const period = priorPeriod(nowMs);
  const db = createDb(env.DB);

  // Closed windows for the just-ended period still awaiting a winner.
  const open = await db
    .select({
      brandId: educationAward.brandId,
      period: educationAward.period,
      closesAt: educationAward.closesAt,
    })
    .from(educationAward)
    .where(
      and(
        eq(educationAward.period, period),
        isNull(educationAward.winnerUserId),
        lte(educationAward.closesAt, nowMs),
      ),
    );

  let awarded = 0;
  for (const award of open) {
    // The period's top budtender for this brand, from the materialized snapshot —
    // same total order as the leaderboard (score DESC, computed_at ASC, user_id ASC).
    const top = (
      await db
        .select({ userId: userBrandScores.userId, score: userBrandScores.score })
        .from(userBrandScores)
        .where(
          and(eq(userBrandScores.brandId, award.brandId), eq(userBrandScores.period, award.period)),
        )
        .orderBy(
          desc(userBrandScores.score),
          asc(userBrandScores.computedAt),
          asc(userBrandScores.userId),
        )
        .limit(1)
    ).at(0);
    if (!top) continue; // no scores this period — nothing to award yet

    // Stamp the winner. The re-asserted `winner_user_id IS NULL` guard makes a
    // concurrent/re-run UPDATE a no-op, so the notification fires at most once.
    const res = await db
      .update(educationAward)
      .set({ winnerUserId: top.userId, winnerName: winnerHandle(top.userId) })
      .where(
        and(
          eq(educationAward.brandId, award.brandId),
          eq(educationAward.period, award.period),
          isNull(educationAward.winnerUserId),
        ),
      );
    if (!res.meta.changes) continue; // already settled by an earlier tick

    await emitNotification({
      brandId: award.brandId,
      userId: top.userId,
      type: "award",
      title: "You earned this period's education fund",
      body: "You led your brand's leaderboard — the education fund is yours to put toward your learning.",
      refType: "education_award",
      refId: award.period,
    });
    awarded++;
  }

  return { awarded };
}

export async function handleCron(
  _controller: unknown,
  _env: unknown,
  _ctx: unknown,
): Promise<void> {
  const ranAt = Date.now();
  const tick: {
    ranAt: number;
    passes: string[];
    leaderboardRows: number;
    sessionLifecycle: {
      toLive: number;
      toEnded: number;
      bookingsCompleted: number;
      reminders: number;
    } | null;
    awardsClosed: number;
  } = {
    ranAt,
    passes: [],
    leaderboardRows: 0,
    sessionLifecycle: null,
    awardsClosed: 0,
  };

  try {
    const { rows } = await recomputeLeaderboard(ranAt);
    tick.passes.push("leaderboard");
    tick.leaderboardRows = rows;
  } catch (err) {
    // A recompute failure must not take down the whole tick (later passes still
    // run once they exist). Log + continue; the snapshot just goes stale.
    console.error("[cron] leaderboard recompute failed", err);
  }

  try {
    tick.sessionLifecycle = await advanceSessionLifecycle(ranAt);
    tick.passes.push("session-lifecycle");
  } catch (err) {
    // Same isolation contract: a lifecycle failure leaves the prior pass intact.
    console.error("[cron] session lifecycle pass failed", err);
  }

  try {
    const { awarded } = await closeAwardWindows(ranAt);
    tick.passes.push("award-close");
    tick.awardsClosed = awarded;
  } catch (err) {
    // Same isolation contract: an award-close failure leaves prior passes intact.
    console.error("[cron] award close pass failed", err);
  }

  console.log("[cron] tick", tick);
}
