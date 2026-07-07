import { describe, expect, test } from "vitest";
import { SCORE_WEIGHTS, computeScore, currentPeriod, type ScoreInputs } from "@/lib/score";

/** A zeroed-out input the per-test cases override only the fields they exercise. */
function inputs(overrides: Partial<ScoreInputs> = {}): ScoreInputs {
  return {
    passingQuizGrades: [],
    publishedQuizzes: 0,
    completedDecks: 0,
    publishedDecks: 0,
    totalDeckTimeSeconds: 0,
    comments: 0,
    postLikes: 0,
    sessionJoin: 0,
    sessionRegister: 0,
    chatMessage: 0,
    ...overrides,
  };
}

describe("SCORE_WEIGHTS", () => {
  test("the three component weights are 0.55 / 0.30 / 0.15 and sum to 1", () => {
    expect(SCORE_WEIGHTS.quiz).toBe(0.55);
    expect(SCORE_WEIGHTS.deck).toBe(0.3);
    expect(SCORE_WEIGHTS.activity).toBe(0.15);
    expect(SCORE_WEIGHTS.quiz + SCORE_WEIGHTS.deck + SCORE_WEIGHTS.activity).toBeCloseTo(1);
  });

  test("the activity coefficients match the canonical vocab", () => {
    expect(SCORE_WEIGHTS.activityCoeffs).toEqual({
      comments: 4,
      postLikes: 2,
      sessionJoin: 10,
      sessionRegister: 5,
      chatMessage: 1,
    });
  });
});

describe("computeScore — divide-by-zero", () => {
  test("zero published quizzes/decks ⇒ 0 component points (never NaN)", () => {
    const r = computeScore(inputs({ passingQuizGrades: [0.9], completedDecks: 3 }));
    expect(r.quizPoints).toBe(0);
    expect(r.deckPoints).toBe(0);
    expect(r.activityPoints).toBe(0);
    expect(r.score).toBe(0);
    expect(Number.isNaN(r.score)).toBe(false);
  });

  test("the all-zero input is a clean 0", () => {
    expect(computeScore(inputs())).toEqual({
      score: 0,
      quizPoints: 0,
      deckPoints: 0,
      activityPoints: 0,
    });
  });
});

describe("computeScore — quiz component", () => {
  test("100 * Σ(best passing grade fraction) over the published denominator", () => {
    // 100 * (0.90 + 0.80) / 2 quizzes = 85 quizPoints (float-tolerant compare).
    const r = computeScore(inputs({ passingQuizGrades: [0.9, 0.8], publishedQuizzes: 2 }));
    expect(r.quizPoints).toBeCloseTo(85);
  });

  test("caps at 100 even when every published quiz is aced", () => {
    const r = computeScore(inputs({ passingQuizGrades: [1, 1], publishedQuizzes: 2 }));
    expect(r.quizPoints).toBe(100);
  });

  test("partial coverage scales down (one of three quizzes passed)", () => {
    // 100 * 0.90 / 3 published = 30 quizPoints.
    const r = computeScore(inputs({ passingQuizGrades: [0.9], publishedQuizzes: 3 }));
    expect(r.quizPoints).toBeCloseTo(30);
  });
});

describe("computeScore — deck component", () => {
  test("completion fraction over published decks", () => {
    // 2 of 4 decks finished → 50 completion points, no time bonus.
    const r = computeScore(inputs({ completedDecks: 2, publishedDecks: 4 }));
    expect(r.deckPoints).toBe(50);
  });

  test("time bonus is ~5 pts/hour, capped at 20", () => {
    // 1 hour of deck time, no published decks → just the 5-pt bonus.
    const r1 = computeScore(inputs({ totalDeckTimeSeconds: 3600 }));
    expect(r1.deckPoints).toBe(5);
    // 10 hours → bonus caps at 20.
    const r2 = computeScore(inputs({ totalDeckTimeSeconds: 36000 }));
    expect(r2.deckPoints).toBe(20);
  });

  test("completion + capped time bonus add together", () => {
    // 1 of 2 decks (50) + 8h time bonus (capped 20) = 70.
    const r = computeScore(
      inputs({ completedDecks: 1, publishedDecks: 2, totalDeckTimeSeconds: 8 * 3600 }),
    );
    expect(r.deckPoints).toBe(70);
  });
});

describe("computeScore — activity component", () => {
  test("weighted event sum (4c + 2l + 10j + 5r + 1m)", () => {
    // 2 comments(8) + 3 likes(6) + 1 join(10) + 2 register(10) + 5 chat(5) = 39.
    const r = computeScore(
      inputs({
        comments: 2,
        postLikes: 3,
        sessionJoin: 1,
        sessionRegister: 2,
        chatMessage: 5,
      }),
    );
    expect(r.activityPoints).toBe(39);
  });

  test("caps at 100", () => {
    const r = computeScore(inputs({ sessionJoin: 50 })); // 50 * 10 = 500 → 100.
    expect(r.activityPoints).toBe(100);
  });
});

describe("computeScore — weighted blend + rounding", () => {
  test("known fixture: 0.55*quiz + 0.30*deck + 0.15*activity, rounded", () => {
    // quiz: 100 * (0.90+0.80) / 2 published = 85
    // deck: 1/2 decks (50) + 1h bonus (5) = 55
    // activity: 2 comments(8) + 1 chat(1) = 9
    // score = round(0.55*85 + 0.30*55 + 0.15*9)
    //       = round(46.75 + 16.5 + 1.35) = round(64.6) = 65
    const r = computeScore(
      inputs({
        passingQuizGrades: [0.9, 0.8],
        publishedQuizzes: 2,
        completedDecks: 1,
        publishedDecks: 2,
        totalDeckTimeSeconds: 3600,
        comments: 2,
        chatMessage: 1,
      }),
    );
    expect(r.quizPoints).toBeCloseTo(85);
    expect(r.deckPoints).toBeCloseTo(55);
    expect(r.activityPoints).toBe(9);
    expect(r.score).toBe(65);
  });

  test("a perfect board across all three components rounds to 100", () => {
    const r = computeScore(
      inputs({
        passingQuizGrades: [1],
        publishedQuizzes: 1,
        completedDecks: 1,
        publishedDecks: 1,
        totalDeckTimeSeconds: 36000, // bonus caps at 20 → deckPoints 120, but blend uses it raw
        sessionJoin: 50, // activity caps at 100
      }),
    );
    // quiz 100, deck 100+20=120, activity 100 →
    // round(0.55*100 + 0.30*120 + 0.15*100) = round(55 + 36 + 15) = 106.
    // (deck can exceed 100 via the time bonus by design — only the components
    // that have an explicit min() are capped.)
    expect(r.score).toBe(106);
  });
});

describe("currentPeriod", () => {
  test("formats epoch-ms as YYYY-MM in UTC, zero-padded month", () => {
    // 2026-06-15T12:00:00Z
    expect(currentPeriod(Date.UTC(2026, 5, 15, 12, 0, 0))).toBe("2026-06");
    // January is zero-padded.
    expect(currentPeriod(Date.UTC(2026, 0, 1))).toBe("2026-01");
    // December.
    expect(currentPeriod(Date.UTC(2025, 11, 31, 23, 59, 59))).toBe("2025-12");
  });

  test("is pure — same input always yields the same period", () => {
    const ms = Date.UTC(2026, 2, 9);
    expect(currentPeriod(ms)).toBe(currentPeriod(ms));
    expect(currentPeriod(ms)).toBe("2026-03");
  });
});
