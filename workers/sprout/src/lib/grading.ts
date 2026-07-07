/**
 * PURE quiz grading — no `cloudflare:workers`, no env, trivially unit-testable.
 * Dispatches per-type grading logic across sprout's five-type taxonomy (the
 * schema's `questions.type` set):
 *
 *   multiple_choice  single correct option       all-or-nothing
 *   true_false       single correct option        all-or-nothing
 *   image            single correct option        all-or-nothing (image-labelled choices)
 *   select_all       N correct options            WEIGHTED partial credit
 *   matching         left→right pairs (config_json) per-pair partial credit
 *
 * The grader is dispatched per `Question.type`; each handler is a pure function
 * of `(question, options, payload)`. `gradeAttempt` walks the questions, sums the
 * awarded points, and returns the per-question breakdown the caller persists into
 * `attempt_answers` (immutable awarded points — graded once, never re-graded).
 *
 * Determinism: `shuffleWithSeed` is a seeded Fisher-Yates (mulberry32) so an
 * attempt's question + option order is stable across resume/rehydrate from the
 * attempt's `shuffle_seed`.
 */

/** The five sprout question types (= `questions.type` in schema.ts). */
export type QuestionType = "multiple_choice" | "select_all" | "true_false" | "image" | "matching";

/** An authored question, as `gradeAttempt` consumes it (camelCase, options nested). */
export interface GradingQuestion {
  id: string;
  type: QuestionType;
  points: number;
  /** `matching` carries its left→right pairs here: { pairs: [{ leftId, rightText }] }. */
  config: MatchingConfig | Record<string, unknown>;
  options: GradingOption[];
}

/** An authored option. `isCorrect` + `weight` are the grading inputs (redacted client-side). */
export interface GradingOption {
  id: string;
  isCorrect: boolean;
  weight: number;
  /** `matching` right-side value lives here: { right: "..." }. */
  config: OptionConfig;
}

export interface OptionConfig {
  right?: string;
}

/** `matching` question config: each left option binds to a right value by id. */
export interface MatchingConfig {
  type?: "matching";
  pairs?: Array<{ leftId: string; rightText: string }>;
}

/**
 * Discriminated answer payload the learner submits. The grader dispatches on
 * `type` and validates the shape inside its handler; an unknown/mismatched shape
 * scores 0 (vacuously incorrect) rather than throwing.
 */
export type AnswerPayload =
  | { type: "multiple_choice"; questionId: string; optionId: string }
  | { type: "true_false"; questionId: string; optionId: string }
  | { type: "image"; questionId: string; optionId: string }
  | { type: "select_all"; questionId: string; optionIds: string[] }
  /** Each pair binds a left option id to the right value the learner chose. */
  | {
      type: "matching";
      questionId: string;
      pairs: Array<{ leftId: string; rightId: string }>;
    };

export interface GradeResult {
  isCorrect: boolean;
  pointsAwarded: number;
}

export type Grader = (q: GradingQuestion, payload: AnswerPayload) => GradeResult;

/**
 * Single-correct dispatch shared by multiple_choice, true_false, and image — the
 * three single-choice types. All-or-nothing: full points iff the picked option is
 * the (one) `is_correct` option.
 */
function gradeSingleChoice(q: GradingQuestion, payload: AnswerPayload): GradeResult {
  if (
    payload.type !== "multiple_choice" &&
    payload.type !== "true_false" &&
    payload.type !== "image"
  ) {
    return { isCorrect: false, pointsAwarded: 0 };
  }
  const correct = q.options.find((o) => o.isCorrect);
  if (!correct) return { isCorrect: false, pointsAwarded: 0 };
  const isCorrect = correct.id === payload.optionId;
  return { isCorrect, pointsAwarded: isCorrect ? q.points : 0 };
}

/**
 * select_all — WEIGHTED partial credit. Each option carries a `weight`; the score
 * is the fraction of the correct-set's total weight the learner selected, MINUS
 * the weight of any incorrect options they picked (clamped at 0 so over-selecting
 * can't go negative). Full marks only when the selection is exactly the correct
 * set; `isCorrect` reflects that exact match.
 *
 * The denominator is the sum of the correct options' weights, so partial credit
 * is proportional to the question's authored weighting, not a flat per-option
 * split. A question with no correct options scores 0 for any selection.
 */
function gradeSelectAll(q: GradingQuestion, payload: AnswerPayload): GradeResult {
  if (payload.type !== "select_all") return { isCorrect: false, pointsAwarded: 0 };
  const correct = q.options.filter((o) => o.isCorrect);
  if (correct.length === 0) return { isCorrect: false, pointsAwarded: 0 };

  const totalWeight = correct.reduce((s, o) => s + (o.weight > 0 ? o.weight : 0), 0);
  if (totalWeight <= 0) return { isCorrect: false, pointsAwarded: 0 };

  const correctIds = new Set(correct.map((o) => o.id));
  const weightById = new Map(q.options.map((o) => [o.id, o.weight > 0 ? o.weight : 0] as const));
  const givenIds = new Set(payload.optionIds);

  let gained = 0;
  let penalty = 0;
  for (const id of givenIds) {
    const w = weightById.get(id);
    if (w === undefined) continue; // unknown option id — ignored
    if (correctIds.has(id)) gained += w;
    else penalty += w;
  }

  const fraction = Math.max(0, (gained - penalty) / totalWeight);
  const pointsAwarded = fraction * q.points;
  // Exact-match flag: every correct option chosen, nothing extra.
  const isCorrect =
    givenIds.size === correctIds.size && [...correctIds].every((id) => givenIds.has(id));
  return { isCorrect, pointsAwarded };
}

/**
 * matching — per-pair partial credit. The authored pairs live in the question's
 * `config_json` ({ pairs: [{ leftId, rightText }] }); each pair is worth an equal
 * share of the question's points. A learner pair is correct when the chosen right
 * VALUE matches the authored right value for that left. The learner's `rightId`
 * is an option id whose `config.right` is the chosen value (mirrors the take-side
 * shuffle of right values). Full marks only when every pair is correct.
 */
function gradeMatching(q: GradingQuestion, payload: AnswerPayload): GradeResult {
  if (payload.type !== "matching") return { isCorrect: false, pointsAwarded: 0 };
  const cfg = q.config as MatchingConfig;
  const authored = Array.isArray(cfg.pairs) ? cfg.pairs : [];
  if (authored.length === 0) return { isCorrect: false, pointsAwarded: 0 };

  // Resolve a learner's chosen rightId → its right value (option.config.right).
  const rightValueById = new Map(
    q.options.map((o) => [o.id, (o.config.right ?? "").trim()] as const),
  );
  const chosenByLeft = new Map<string, string>();
  for (const pair of payload.pairs) {
    const value = rightValueById.get(pair.rightId);
    if (value !== undefined) chosenByLeft.set(pair.leftId, value);
  }

  const perPair = q.points / authored.length;
  let awarded = 0;
  let correctCount = 0;
  for (const pair of authored) {
    const chosen = chosenByLeft.get(pair.leftId);
    if (chosen !== undefined && chosen === pair.rightText.trim()) {
      awarded += perPair;
      correctCount += 1;
    }
  }
  const isCorrect = correctCount === authored.length;
  return { isCorrect, pointsAwarded: awarded };
}

/** Per-type grader table. A missing grader scores 0 (defensive against new types). */
export const graders: Record<QuestionType, Grader> = {
  multiple_choice: gradeSingleChoice,
  true_false: gradeSingleChoice,
  image: gradeSingleChoice,
  select_all: gradeSelectAll,
  matching: gradeMatching,
};

export interface PerQuestionResult {
  questionId: string;
  isCorrect: boolean;
  pointsAwarded: number;
}

export interface AttemptGrade {
  perQuestion: PerQuestionResult[];
  score: number;
  maxScore: number;
}

/**
 * Grade every question in an attempt. Pure — the caller resolves the question
 * rows + their options + the answers map up front; this just does the math.
 * Unanswered questions score 0. Returns totals + the per-question breakdown the
 * caller freezes into `attempt_answers`.
 *
 * `passed(threshold)` is a convenience on the returned object: `passed` iff the
 * overall percentage ≥ the quiz's pass threshold (a percent, e.g. 80). An empty
 * quiz (maxScore ≤ 0) never passes (vacuously failing is the less-surprising
 * default, mirroring the quiz app's `isPassed`).
 */
export function gradeAttempt(
  questions: GradingQuestion[],
  answersByQuestionId: Map<string, AnswerPayload>,
): AttemptGrade & { passed: (threshold: number) => boolean } {
  let score = 0;
  let maxScore = 0;
  const perQuestion: PerQuestionResult[] = [];

  for (const q of questions) {
    maxScore += q.points;
    const payload = answersByQuestionId.get(q.id);
    if (!payload) {
      perQuestion.push({ questionId: q.id, isCorrect: false, pointsAwarded: 0 });
      continue;
    }
    const grader = graders[q.type];
    const { isCorrect, pointsAwarded } = grader(q, payload);
    score += pointsAwarded;
    perQuestion.push({ questionId: q.id, isCorrect, pointsAwarded });
  }

  return {
    perQuestion,
    score,
    maxScore,
    passed: (threshold: number) => {
      if (maxScore <= 0) return false;
      return (score / maxScore) * 100 >= threshold;
    },
  };
}

// ─── deterministic shuffle (seeded Fisher-Yates) ────────────────────────────

/** Tiny deterministic PRNG so per-attempt shuffles are stable on rehydrate. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable seeded shuffle — a Fisher-Yates driven by `mulberry32(seed)`. Same
 * `(items, seed)` → same permutation every call, so an attempt's question + option
 * order survives resume/rehydrate from the persisted `shuffle_seed`.
 */
export function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const rng = mulberry32(seed);
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** FNV-1a string hash — mixes a question/option id into a per-attempt seed so
 * different questions in the same attempt get independent permutations. */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
