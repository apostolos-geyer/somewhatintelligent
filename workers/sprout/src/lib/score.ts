/**
 * PURE leaderboard score math (P2.E) — no `cloudflare:workers`, no env, no clock,
 * so the canonical formula is trivially unit-testable in plain node. The cron
 * (`jobs/cron.ts`) is the ONE caller that reads D1, projects each (user, brand)'s
 * inputs for the period, and feeds them here; the materialized result lands in
 * `user_brand_scores`. Leaderboards read that snapshot, never re-run this math.
 *
 * The three components each cap at 100; the weighted blend rounds to an integer.
 * Divide-by-zero (a brand with zero published quizzes/decks this period) yields 0
 * points for that component rather than NaN — a fresh brand sits at score 0.
 */

/**
 * The weighted blend + the activity-event coefficients. ONE source of truth for
 * the formula constants so the cron and the tests can't drift. `quiz`/`deck`/
 * `activity` sum to 1; `activity.*` are the per-event point values folded into
 * the (capped-at-100) activity component.
 */
export const SCORE_WEIGHTS = {
  quiz: 0.55,
  deck: 0.3,
  activity: 0.15,
  /** Per-event activity coefficients (P3/P4 signals; 0 until those tables land). */
  activityCoeffs: {
    comments: 4,
    postLikes: 2,
    sessionJoin: 10,
    sessionRegister: 5,
    chatMessage: 1,
  },
} as const;

/** The plain-object inputs the cron projects per (user, brand) for the period. */
export interface ScoreInputs {
  /**
   * Best PASSING grade FRACTION (0..1) per quiz this period — one entry per quiz
   * the user passed (e.g. `[0.92, 0.80]` = a 92% and an 80%). Non-passing attempts
   * contribute nothing, so the cron only pushes a quiz's best `score / maxScore`
   * here when that attempt cleared the threshold. Fractions (not 0..100 percents)
   * so the `100 * Σ / publishedQuizzes` blend lands on the 0..100 quiz scale.
   */
  passingQuizGrades: number[];
  /** Count of published quizzes for the brand this period (the quiz denominator). */
  publishedQuizzes: number;

  /** Count of decks the user finished (last_page >= page_count). */
  completedDecks: number;
  /** Count of published decks for the brand (the deck denominator). */
  publishedDecks: number;
  /** Total seconds the user spent in decks this period (the time bonus input). */
  totalDeckTimeSeconds: number;

  // ── Activity signals (P3/P4 — read defensively as 0 until those tables land) ──
  comments: number;
  postLikes: number;
  sessionJoin: number;
  sessionRegister: number;
  chatMessage: number;
}

export interface ScoreResult {
  score: number;
  quizPoints: number;
  deckPoints: number;
  activityPoints: number;
}

/**
 * The canonical composite-score formula (docs/sprout §P2.E). Each component is
 * its own 0..100 scale; the weighted blend is rounded to an integer score.
 *
 *   quizPoints     = min(100, 100 * Σ(best passing grade fraction) / publishedQuizzes)
 *   deckPoints     = 100 * (completed decks / publishedDecks)
 *                    + min(20, totalDeckTimeSeconds / 3600 * 5)
 *   activityPoints = min(100, 4*comments + 2*postLikes + 10*sessionJoin
 *                              + 5*sessionRegister + 1*chatMessage)
 *   score          = round(0.55*quiz + 0.30*deck + 0.15*activity)
 *
 * Divide-by-zero guard: a 0 denominator (no published quizzes / decks) makes that
 * fraction 0, never NaN. The deck time bonus stands on its own even with 0
 * published decks, so a user who only logged deck time still earns it.
 */
export function computeScore(inputs: ScoreInputs): ScoreResult {
  const { activityCoeffs } = SCORE_WEIGHTS;

  // ── Quiz: Σ(best passing grade fraction) over the published denominator, capped. ──
  const quizSum = inputs.passingQuizGrades.reduce((acc, g) => acc + g, 0);
  const quizPoints =
    inputs.publishedQuizzes > 0 ? Math.min(100, (100 * quizSum) / inputs.publishedQuizzes) : 0;

  // ── Deck: completion fraction + a time bonus (max 20, ~5 pts/hour). ──
  const completionPoints =
    inputs.publishedDecks > 0 ? (100 * inputs.completedDecks) / inputs.publishedDecks : 0;
  const timeBonus = Math.min(20, (inputs.totalDeckTimeSeconds / 3600) * 5);
  const deckPoints = completionPoints + timeBonus;

  // ── Activity: weighted event sum, capped. (All 0 until P3/P4 signals land.) ──
  const activityPoints = Math.min(
    100,
    activityCoeffs.comments * inputs.comments +
      activityCoeffs.postLikes * inputs.postLikes +
      activityCoeffs.sessionJoin * inputs.sessionJoin +
      activityCoeffs.sessionRegister * inputs.sessionRegister +
      activityCoeffs.chatMessage * inputs.chatMessage,
  );

  const score = Math.round(
    SCORE_WEIGHTS.quiz * quizPoints +
      SCORE_WEIGHTS.deck * deckPoints +
      SCORE_WEIGHTS.activity * activityPoints,
  );

  return { score, quizPoints, deckPoints, activityPoints };
}

/**
 * The period key a score row is bucketed under: `"YYYY-MM"` in UTC. Pure — takes
 * `nowMs` explicitly (no argless `Date`) so the cron's clock is the single source
 * of "now" and the function is deterministic under test.
 */
export function currentPeriod(nowMs: number): string {
  const d = new Date(nowMs);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 0-indexed
  return `${year}-${month < 10 ? "0" : ""}${month}`;
}
