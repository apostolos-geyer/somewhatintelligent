/**
 * Unit tests for the PURE quiz grader (`src/lib/grading.ts`).
 *
 * These codify the EXACT grading mechanism per question type — most importantly
 * `matching`, whose authored shape is the one a content seed (and Brand Admin)
 * must produce:
 *   - question.config = { pairs: [{ leftId: <optionId>, rightText: <value> }] }
 *   - option.config   = { right: <value> }
 * A learner submits pairs of { leftId, rightId }; the grader resolves
 * rightId → option.config.right and compares to the authored rightText. A
 * mis-keyed config (the bug this suite guards) yields zero credit, so these
 * tests fail loudly if that contract drifts.
 */
import { describe, expect, it } from "vitest";
import {
  gradeAttempt,
  graders,
  shuffleWithSeed,
  type AnswerPayload,
  type GradingQuestion,
} from "@/lib/grading";

const single = (id: string, correctId: string): GradingQuestion => ({
  id,
  type: "multiple_choice",
  points: 1,
  config: {},
  options: [
    { id: `${id}_a`, isCorrect: `${id}_a` === correctId, weight: 1, config: {} },
    { id: `${id}_b`, isCorrect: `${id}_b` === correctId, weight: 1, config: {} },
    { id: `${id}_c`, isCorrect: `${id}_c` === correctId, weight: 1, config: {} },
  ],
});

describe("single-choice graders (multiple_choice / true_false / image)", () => {
  it("awards full points for the correct option", () => {
    const q = single("q1", "q1_a");
    const r = graders.multiple_choice(q, {
      type: "multiple_choice",
      questionId: "q1",
      optionId: "q1_a",
    });
    expect(r).toEqual({ isCorrect: true, pointsAwarded: 1 });
  });

  it("awards zero for a wrong option", () => {
    const q = single("q1", "q1_a");
    const r = graders.multiple_choice(q, {
      type: "multiple_choice",
      questionId: "q1",
      optionId: "q1_b",
    });
    expect(r).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });

  it("scores 0 on a payload/type mismatch instead of throwing", () => {
    const q = single("q1", "q1_a");
    const r = graders.multiple_choice(q, {
      type: "select_all",
      questionId: "q1",
      optionIds: ["q1_a"],
    });
    expect(r).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });
});

describe("select_all grader — weighted partial credit", () => {
  const q: GradingQuestion = {
    id: "sa",
    type: "select_all",
    points: 10,
    config: {},
    options: [
      { id: "a", isCorrect: true, weight: 1, config: {} },
      { id: "b", isCorrect: true, weight: 1, config: {} },
      { id: "c", isCorrect: false, weight: 1, config: {} },
    ],
  };

  it("full marks + isCorrect for the exact correct set", () => {
    const r = graders.select_all(q, {
      type: "select_all",
      questionId: "sa",
      optionIds: ["a", "b"],
    });
    expect(r.isCorrect).toBe(true);
    expect(r.pointsAwarded).toBeCloseTo(10);
  });

  it("partial credit for a subset (not isCorrect)", () => {
    const r = graders.select_all(q, { type: "select_all", questionId: "sa", optionIds: ["a"] });
    expect(r.isCorrect).toBe(false);
    expect(r.pointsAwarded).toBeCloseTo(5);
  });

  it("penalises a wrong pick and clamps at 0", () => {
    const r = graders.select_all(q, {
      type: "select_all",
      questionId: "sa",
      optionIds: ["a", "c"],
    });
    expect(r.pointsAwarded).toBeCloseTo(0); // gained 1 - penalty 1 = 0
    const worse = graders.select_all(q, {
      type: "select_all",
      questionId: "sa",
      optionIds: ["c"],
    });
    expect(worse.pointsAwarded).toBe(0); // never negative
  });
});

describe("matching grader — the authored config shape (regression guard)", () => {
  // Two left options whose ids ARE the leftIds in config.pairs; each option's
  // config.right is the value the learner's chosen rightId resolves to.
  const q: GradingQuestion = {
    id: "m",
    type: "matching",
    points: 2,
    config: {
      pairs: [
        { leftId: "myrcene", rightText: "Relaxation" },
        { leftId: "limonene", rightText: "Uplift" },
      ],
    },
    options: [
      { id: "myrcene", isCorrect: true, weight: 1, config: { right: "Relaxation" } },
      { id: "limonene", isCorrect: true, weight: 1, config: { right: "Uplift" } },
    ],
  };

  it("awards full points when every pair maps to its authored right value", () => {
    const payload: AnswerPayload = {
      type: "matching",
      questionId: "m",
      pairs: [
        { leftId: "myrcene", rightId: "myrcene" }, // right id whose config.right === "Relaxation"
        { leftId: "limonene", rightId: "limonene" }, // config.right === "Uplift"
      ],
    };
    expect(graders.matching(q, payload)).toEqual({ isCorrect: true, pointsAwarded: 2 });
  });

  it("gives per-pair partial credit", () => {
    const payload: AnswerPayload = {
      type: "matching",
      questionId: "m",
      pairs: [
        { leftId: "myrcene", rightId: "myrcene" },
        { leftId: "limonene", rightId: "myrcene" }, // wrong: resolves to "Relaxation"
      ],
    };
    const r = graders.matching(q, payload);
    expect(r.isCorrect).toBe(false);
    expect(r.pointsAwarded).toBeCloseTo(1); // 1 of 2 pairs
  });

  it("scores 0 when option.config.right is missing (the mis-keyed-seed bug)", () => {
    // Mirrors my original broken seed: option.config used {match:...} not {right:...},
    // so rightId resolves to "" and no pair matches the authored rightText.
    const broken: GradingQuestion = {
      ...q,
      options: q.options.map((o) => ({ ...o, config: {} })),
    };
    const payload: AnswerPayload = {
      type: "matching",
      questionId: "m",
      pairs: [
        { leftId: "myrcene", rightId: "myrcene" },
        { leftId: "limonene", rightId: "limonene" },
      ],
    };
    expect(graders.matching(broken, payload).pointsAwarded).toBe(0);
  });

  it("scores 0 when config.pairs is absent", () => {
    const noPairs: GradingQuestion = { ...q, config: {} };
    const payload: AnswerPayload = {
      type: "matching",
      questionId: "m",
      pairs: [{ leftId: "myrcene", rightId: "myrcene" }],
    };
    expect(graders.matching(noPairs, payload)).toEqual({ isCorrect: false, pointsAwarded: 0 });
  });
});

describe("gradeAttempt — totals, unanswered, and pass threshold", () => {
  const questions: GradingQuestion[] = [single("q1", "q1_a"), single("q2", "q2_a")];

  it("sums per-question points and reports maxScore", () => {
    const answers = new Map<string, AnswerPayload>([
      ["q1", { type: "multiple_choice", questionId: "q1", optionId: "q1_a" }],
      ["q2", { type: "multiple_choice", questionId: "q2", optionId: "q2_b" }],
    ]);
    const g = gradeAttempt(questions, answers);
    expect(g.maxScore).toBe(2);
    expect(g.score).toBe(1);
    expect(g.perQuestion).toHaveLength(2);
  });

  it("treats unanswered questions as zero", () => {
    const g = gradeAttempt(questions, new Map());
    expect(g.score).toBe(0);
    expect(g.perQuestion.every((p) => !p.isCorrect)).toBe(true);
  });

  it("passed(threshold) compares the percentage; empty quiz never passes", () => {
    const answers = new Map<string, AnswerPayload>([
      ["q1", { type: "multiple_choice", questionId: "q1", optionId: "q1_a" }],
      ["q2", { type: "multiple_choice", questionId: "q2", optionId: "q2_a" }],
    ]);
    const g = gradeAttempt(questions, answers);
    expect(g.passed(80)).toBe(true); // 100%
    expect(g.passed(100)).toBe(true);
    expect(gradeAttempt([], new Map()).passed(0)).toBe(false);
  });
});

describe("shuffleWithSeed — deterministic permutation", () => {
  it("same (items, seed) → same order; different seed → (usually) different", () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(shuffleWithSeed([...items], 42)).toEqual(shuffleWithSeed([...items], 42));
    expect(shuffleWithSeed([...items], 42)).not.toEqual(shuffleWithSeed([...items], 7));
  });
});
