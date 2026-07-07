/**
 * Quiz + certification server functions (P2.D), namespaced to sprout's
 * `brand_id` tenancy. Two tenancy modes, per the §02
 * invariant (brand_id is NEVER input):
 *
 *  - The budtender take-flow (`listQuizzes`, `startAttempt`, `resumeAttempt`,
 *    `saveProgress`, `gradeAttempt`) gates with `requireUserMiddleware`. A quiz is
 *    visible iff it's published AND (its `brand_id IS NULL` [public/platform] OR
 *    `brand_id === activeOrgId`). Questions are graded SERVER-SIDE only: the
 *    `is_correct` / `weight` / matching-right fields are stripped from every
 *    take-side payload (Invariant I2 — correct answers never reach the client
 *    pre-submit).
 *  - The Brand-Admin builder (`upsertQuiz`, `upsertQuestion`, `upsertOption`,
 *    `deleteQuestion`, `publishQuiz`) additionally gates IN-HANDLER on
 *    `decideBrandAdmin`. Every mutation calls `writeAudit` in the same logical
 *    write. Admin quizzes are always brand-scoped (`brand_id = activeOrgId`).
 *
 * Graded-immutable: `attempt_answers` freezes the awarded points at submit; the
 * result read never re-grades. A pass on a cert quiz (`cert_name` set) inserts a
 * `certifications` row `ON CONFLICT(brand_id,user_id,quiz_id) DO NOTHING` and
 * emits `cert_awarded`; submit also enqueues `attempt.completed` for the
 * leaderboard re-index.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, count, desc, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import {
  attemptAnswers,
  attempts,
  certifications,
  questionOptions,
  questions,
  quizzes,
} from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import {
  gradeAttempt as gradeAttemptPure,
  hashString,
  shuffleWithSeed,
  type AnswerPayload,
  type GradingOption,
  type GradingQuestion,
  type MatchingConfig,
  type QuestionType,
} from "@/lib/grading";

// Re-export the answer payload shape so the section components (QuestionCard /
// QuizzesSection) consume one source for both the redacted question + the answer.
export type { AnswerPayload } from "@/lib/grading";

// ─── domain types (camelCase; mapped at the I/O edge) ───────────────────────

export const QUESTION_TYPES = [
  "multiple_choice",
  "select_all",
  "true_false",
  "image",
  "matching",
] as const;

export function isQuestionType(v: unknown): v is QuestionType {
  return typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v);
}

/** A quiz as the budtender listing renders it (no question bodies). */
export interface QuizListItem {
  id: string;
  title: string;
  description: string;
  passThreshold: number;
  certName: string | null;
  onLeaderboard: boolean;
  questionCount: number;
  /** True when this caller's `brand_id IS NULL` public quiz vs their own brand. */
  isPublic: boolean;
  /** The caller's best result on this quiz, if they've ever submitted one. */
  passed: boolean | null;
  certified: boolean;
}

/** The take-side question — REDACTED: no is_correct / weight / matching-right. */
export type PublicQuestion =
  | {
      id: string;
      type: "multiple_choice" | "true_false" | "image";
      prompt: string;
      imageRef: string | null;
      points: number;
      options: PublicOption[];
    }
  | {
      id: string;
      type: "select_all";
      prompt: string;
      imageRef: string | null;
      points: number;
      options: PublicOption[];
    }
  | {
      id: string;
      type: "matching";
      prompt: string;
      imageRef: string | null;
      points: number;
      lefts: PublicOption[];
      /** Shuffled right-side values; each id round-trips back as the chosen `rightId`. */
      rights: PublicOption[];
    };

export interface PublicOption {
  id: string;
  text: string;
  imageRef: string | null;
}

/** The payload `startAttempt` / `resumeAttempt` returns — drives the take-flow. */
export interface ActiveAttempt {
  attemptId: string;
  quizId: string;
  title: string;
  passThreshold: number;
  timeLimitSeconds: number | null;
  deadlineAt: number | null;
  certName: string | null;
  questions: PublicQuestion[];
  /** The learner's in-progress answers (autosaved), keyed by questionId. */
  answers: Record<string, AnswerPayload>;
  currentQuestion: number;
}

/**
 * One row of the result screen's per-question breakdown. Surfaced from the
 * IMMUTABLE `attempt_answers` freeze (never re-graded) joined to the authored
 * question/option text + the Brand-Admin `explanation`. Wrong answers reveal the
 * correct answer + explanation; the learner's own submission is rendered back as
 * human-readable text (option labels / matching pairs), not raw ids.
 */
export interface PerQuestionResult {
  questionId: string;
  type: QuestionType;
  prompt: string;
  points: number;
  pointsAwarded: number;
  isCorrect: boolean;
  /** The Brand-Admin authored explanation (shown on wrong answers). */
  explanation: string | null;
  /** The learner's submitted answer, rendered as label text (may be empty when unanswered). */
  yourAnswer: string[];
  /** The authored correct answer, rendered as label text. */
  correctAnswer: string[];
}

/** The graded result the result screen renders. */
export interface AttemptResultView {
  attemptId: string;
  quizId: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  certName: string | null;
  /** Set when this submit (or an earlier pass) earned the certification. */
  certified: boolean;
  /** The per-question breakdown (wrong answers reveal correct + explanation). */
  perQuestion: PerQuestionResult[];
}

/** A budtender's earned certification, for the persistent header badge list. */
export interface EarnedCertification {
  quizId: string;
  name: string;
  awardedAt: number;
}

/** An in-progress (open) attempt, surfaced as the section's Resume banner. */
export interface OpenAttempt {
  attemptId: string;
  quizId: string;
  title: string;
  /** answered / total, so the banner can show progress without loading the quiz. */
  answered: number;
  total: number;
  startedAt: number;
}

// ─── snake_case row shapes ──────────────────────────────────────────────────

interface QuizRow {
  id: string;
  brand_id: string | null;
  title: string;
  description: string;
  pass_threshold: number;
  retakes_allowed: number;
  max_attempts: number | null;
  time_limit_seconds: number | null;
  cert_name: string | null;
  on_leaderboard: number;
  shuffle_questions: number;
  status: string;
  created_at: number;
  updated_at: number;
  created_by: string;
}

interface AttemptRow {
  id: string;
  brand_id: string | null;
  quiz_id: string;
  user_id: string;
  shuffle_seed: number;
  answers_json: string;
  current_question: number;
  score: number | null;
  max_score: number;
  passed: number | null;
  status: string;
  started_at: number;
  deadline_at: number | null;
  submitted_at: number | null;
  time_spent_seconds: number | null;
}

const DEFAULT_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24h fallback when no time limit

function parseOptionConfig(json: string): { right?: string } {
  if (!json || json === "{}") return {};
  try {
    const parsed = JSON.parse(json) as { right?: unknown };
    return typeof parsed.right === "string" ? { right: parsed.right } : {};
  } catch {
    return {};
  }
}

function parseMatchingConfig(json: string): MatchingConfig {
  if (!json || json === "{}") return {};
  try {
    const parsed = JSON.parse(json) as { pairs?: unknown };
    if (!Array.isArray(parsed.pairs)) return {};
    const pairs = parsed.pairs
      .filter(
        (p): p is { leftId: unknown; rightText: unknown } => typeof p === "object" && p !== null,
      )
      .map((p) => ({ leftId: String(p.leftId ?? ""), rightText: String(p.rightText ?? "") }))
      .filter((p) => p.leftId.length > 0);
    return { type: "matching", pairs };
  } catch {
    return {};
  }
}

/** Narrow D1's untyped `type` string to the closed set (default multiple_choice). */
function asQuestionType(v: string): QuestionType {
  return isQuestionType(v) ? v : "multiple_choice";
}

/**
 * Drizzle returns camelCase rows; the downstream helpers (buildActiveAttempt,
 * mapAdminQuiz, certification insert) read the `QuizRow` snake_case contract.
 * Re-key the typed quiz row back to that exact shape so nothing else changes.
 */
function toAttemptRow(a: typeof attempts.$inferSelect): AttemptRow {
  return {
    id: a.id,
    brand_id: a.brandId,
    quiz_id: a.quizId,
    user_id: a.userId,
    shuffle_seed: a.shuffleSeed,
    answers_json: a.answersJson,
    current_question: a.currentQuestion,
    score: a.score,
    max_score: a.maxScore,
    passed: a.passed,
    status: a.status,
    started_at: a.startedAt,
    deadline_at: a.deadlineAt,
    submitted_at: a.submittedAt,
    time_spent_seconds: a.timeSpentSeconds,
  };
}

function toQuizRow(q: typeof quizzes.$inferSelect): QuizRow {
  return {
    id: q.id,
    brand_id: q.brandId,
    title: q.title,
    description: q.description,
    pass_threshold: q.passThreshold,
    retakes_allowed: q.retakesAllowed,
    max_attempts: q.maxAttempts,
    time_limit_seconds: q.timeLimitSeconds,
    cert_name: q.certName,
    on_leaderboard: q.onLeaderboard,
    shuffle_questions: q.shuffleQuestions,
    status: q.status,
    created_at: q.createdAt,
    updated_at: q.updatedAt,
    created_by: q.createdBy,
  };
}

// ─── shared loaders ─────────────────────────────────────────────────────────

/**
 * Load a quiz the caller may take + its authored questions/options. Visibility:
 * published AND (`brand_id IS NULL` OR `brand_id === brandId`). Returns null when
 * the quiz is missing, unpublished, or another brand's — a forged `quizId`
 * resolves to "not found", never another brand's content.
 */
async function loadTakeableQuiz(
  quizId: string,
  brandId: string | null,
): Promise<{ quiz: QuizRow; questions: GradingQuestion[] } | null> {
  const db = createDb(env.DB);
  // brand_id IS NULL OR brand_id = brandId. eq() rejects a null value, and a
  // null-org caller must see public quizzes only — matching the original raw
  // `brand_id = ?`=NULL (never matches under SQLite) semantics.
  const visibility =
    brandId === null
      ? isNull(quizzes.brandId)
      : or(isNull(quizzes.brandId), eq(quizzes.brandId, brandId));
  const quizRow = (
    await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.status, "published"), visibility))
      .limit(1)
  ).at(0);
  if (!quizRow) return null;
  const quiz = toQuizRow(quizRow);

  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(questions.orderIdx, questions.createdAt);
  if (qs.length === 0) return null;

  const optRows = await db
    .select({ opt: questionOptions })
    .from(questionOptions)
    .innerJoin(questions, eq(questions.id, questionOptions.questionId))
    .where(eq(questions.quizId, quizId))
    .orderBy(questionOptions.questionId, questionOptions.orderIdx);
  const byQ = new Map<string, GradingOption[]>();
  for (const { opt: o } of optRows) {
    const arr = byQ.get(o.questionId) ?? [];
    arr.push({
      id: o.id,
      isCorrect: o.isCorrect !== 0,
      weight: o.weight,
      config: parseOptionConfig(o.configJson),
    });
    byQ.set(o.questionId, arr);
  }

  const gradingQuestions: GradingQuestion[] = qs.map((q) => {
    const t = asQuestionType(q.type);
    return {
      id: q.id,
      type: t,
      points: q.points,
      config: t === "matching" ? parseMatchingConfig(q.configJson) : {},
      options: byQ.get(q.id) ?? [],
    };
  });

  return { quiz, questions: gradingQuestions };
}

/** The display rows (prompt/imageRef/option text) keyed alongside grading rows. */
interface DisplayQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  imageRef: string | null;
  points: number;
  /** The Brand-Admin authored explanation — surfaced ONLY on the result read. */
  explanation: string | null;
  options: Array<{ id: string; text: string; imageRef: string | null; right: string }>;
  config: MatchingConfig;
}

async function loadDisplayQuestions(quizId: string): Promise<DisplayQuestion[]> {
  const db = createDb(env.DB);
  const qs = await db
    .select()
    .from(questions)
    .where(eq(questions.quizId, quizId))
    .orderBy(questions.orderIdx, questions.createdAt);

  const optRows = await db
    .select({ opt: questionOptions })
    .from(questionOptions)
    .innerJoin(questions, eq(questions.id, questionOptions.questionId))
    .where(eq(questions.quizId, quizId))
    .orderBy(questionOptions.questionId, questionOptions.orderIdx);
  const byQ = new Map<
    string,
    Array<{ id: string; text: string; imageRef: string | null; right: string }>
  >();
  for (const { opt: o } of optRows) {
    const arr = byQ.get(o.questionId) ?? [];
    arr.push({
      id: o.id,
      text: o.text,
      imageRef: o.imageRef,
      right: parseOptionConfig(o.configJson).right ?? "",
    });
    byQ.set(o.questionId, arr);
  }

  return qs.map((q) => {
    const t = asQuestionType(q.type);
    return {
      id: q.id,
      type: t,
      prompt: q.prompt,
      imageRef: q.imageRef,
      points: q.points,
      explanation: q.explanation,
      options: (byQ.get(q.id) ?? []).map((o) => ({
        id: o.id,
        text: o.text,
        imageRef: o.imageRef,
        right: o.right,
      })),
      config: t === "matching" ? parseMatchingConfig(q.configJson) : {},
    };
  });
}

/**
 * Project a display question to its REDACTED public shape in the attempt's
 * shuffle order. matching right-VALUES are emitted as synthetic options whose id
 * is `right:<optionId>` so the take-side select round-trips a `rightId` the
 * grader resolves back to a value — the left→right authored mapping is never
 * recoverable from row order (rights are seed-shuffled per question).
 */
function redactQuestions(questions: DisplayQuestion[], shuffleSeed: number): PublicQuestion[] {
  // Stable per-attempt question order.
  const ordered = shuffleWithSeed(questions, shuffleSeed);
  return ordered.map((q): PublicQuestion => {
    const base = { id: q.id, prompt: q.prompt, imageRef: q.imageRef, points: q.points };
    if (q.type === "matching") {
      const lefts = q.options.map((o) => ({ id: o.id, text: o.text, imageRef: o.imageRef }));
      const cfg = q.config;
      const authoredPairs = Array.isArray(cfg.pairs) ? cfg.pairs : [];
      // The right VALUES, deduped; ids re-keyed to the option whose config.right
      // is that value so the grader's `rightValueById` lookup succeeds.
      const rightByLeft = new Map(authoredPairs.map((p) => [p.leftId, p.rightText] as const));
      const rights = q.options.map((o) => ({
        id: o.id,
        text: rightByLeft.get(o.id) ?? "",
        imageRef: null,
      }));
      const qSeed = (shuffleSeed ^ hashString(q.id)) >>> 0;
      return { ...base, type: "matching", lefts, rights: shuffleWithSeed(rights, qSeed) };
    }
    const options = q.options.map((o) => ({ id: o.id, text: o.text, imageRef: o.imageRef }));
    if (q.type === "select_all") {
      return { ...base, type: "select_all", options };
    }
    return { ...base, type: q.type, options };
  });
}

/** Loose JSON → answers map. Drops any entry whose shape doesn't validate. */
function parseAnswers(json: string): Record<string, AnswerPayload> {
  if (!json || json === "{}") return {};
  try {
    const raw = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, AnswerPayload> = {};
    for (const [qid, v] of Object.entries(raw)) {
      const payload = coerceAnswer(qid, v);
      if (payload) out[qid] = payload;
    }
    return out;
  } catch {
    return {};
  }
}

/** Validate one stored/submitted answer into a typed `AnswerPayload`, or null. */
function coerceAnswer(questionId: string, v: unknown): AnswerPayload | null {
  if (typeof v !== "object" || v === null) return null;
  const a = v as Record<string, unknown>;
  const t = a.type;
  if (t === "multiple_choice" || t === "true_false" || t === "image") {
    if (typeof a.optionId !== "string") return null;
    return { type: t, questionId, optionId: a.optionId };
  }
  if (t === "select_all") {
    if (!Array.isArray(a.optionIds)) return null;
    return {
      type: "select_all",
      questionId,
      optionIds: a.optionIds.filter((x): x is string => typeof x === "string"),
    };
  }
  if (t === "matching") {
    if (!Array.isArray(a.pairs)) return null;
    const pairs = a.pairs
      .filter(
        (p): p is { leftId: unknown; rightId: unknown } => typeof p === "object" && p !== null,
      )
      .map((p) => ({ leftId: String(p.leftId ?? ""), rightId: String(p.rightId ?? "") }))
      .filter((p) => p.leftId.length > 0 && p.rightId.length > 0);
    return { type: "matching", questionId, pairs };
  }
  return null;
}

/**
 * Render a learner's stored answer payload into human-readable label text using
 * the authored display question (option labels / matching pairs), so the result
 * screen never shows raw ids. Empty array = unanswered.
 */
function renderSubmittedAnswer(q: DisplayQuestion, payload: AnswerPayload | null): string[] {
  if (!payload) return [];
  const textById = new Map(q.options.map((o) => [o.id, o.text] as const));
  const rightById = new Map(q.options.map((o) => [o.id, o.right] as const));
  if (payload.type === "matching") {
    return payload.pairs
      .map((p) => {
        const left = textById.get(p.leftId);
        const right = rightById.get(p.rightId);
        if (left === undefined || right === undefined || right === "") return null;
        return `${left} → ${right}`;
      })
      .filter((s): s is string => s !== null);
  }
  if (payload.type === "select_all") {
    return payload.optionIds
      .map((id) => textById.get(id))
      .filter((t): t is string => t !== undefined);
  }
  const label = textById.get(payload.optionId);
  return label !== undefined ? [label] : [];
}

/** Render the authored correct answer of a display question into label text. */
function renderCorrectAnswer(q: DisplayQuestion, grading: GradingQuestion): string[] {
  const textById = new Map(q.options.map((o) => [o.id, o.text] as const));
  if (q.type === "matching") {
    const authored = Array.isArray(q.config.pairs) ? q.config.pairs : [];
    return authored
      .map((p) => {
        const left = textById.get(p.leftId);
        if (left === undefined) return null;
        return `${left} → ${p.rightText}`;
      })
      .filter((s): s is string => s !== null);
  }
  // single-choice + select_all: the authored is_correct options.
  return grading.options
    .filter((o) => o.isCorrect)
    .map((o) => textById.get(o.id))
    .filter((t): t is string => t !== undefined);
}

/**
 * One frozen per-question grade — the IMMUTABLE `attempt_answers` fields the
 * result read surfaces verbatim (never re-graded): the learner's stored payload,
 * the frozen correctness, and the frozen awarded points.
 */
interface FrozenAnswer {
  payload: AnswerPayload | null;
  isCorrect: boolean;
  pointsAwarded: number;
}

/**
 * Assemble the per-question result breakdown from the IMMUTABLE per-question
 * grades joined to the authored display question (prompt/option text +
 * explanation) and the grading question (for the authored correct answer). The
 * `frozen` map is keyed by questionId — its `isCorrect`/`pointsAwarded` are
 * surfaced verbatim, never recomputed, honouring the graded-immutable invariant.
 * Questions ordered by the attempt's stable shuffle so the breakdown matches the
 * order the learner saw.
 */
function buildPerQuestion(
  display: DisplayQuestion[],
  grading: GradingQuestion[],
  frozen: Map<string, FrozenAnswer>,
  shuffleSeed: number,
): PerQuestionResult[] {
  const gradingById = new Map(grading.map((g) => [g.id, g] as const));
  const ordered = shuffleWithSeed(display, shuffleSeed);
  return ordered.map((q): PerQuestionResult => {
    const g = gradingById.get(q.id);
    const f = frozen.get(q.id);
    const isCorrect = f?.isCorrect ?? false;
    return {
      questionId: q.id,
      type: q.type,
      prompt: q.prompt,
      points: q.points,
      pointsAwarded: f?.pointsAwarded ?? 0,
      isCorrect,
      // Explanation is the teach-back — only meaningful on a miss, but the row
      // carries it and the UI gates on `isCorrect`.
      explanation: q.explanation,
      yourAnswer: renderSubmittedAnswer(q, f?.payload ?? null),
      correctAnswer: g ? renderCorrectAnswer(q, g) : [],
    };
  });
}

// ─── budtender take-flow (authenticated, envelope-scoped) ───────────────────

/**
 * Gated: the caller's takeable quizzes — published, and either public
 * (`brand_id IS NULL`) or their own brand's (`brand_id === activeOrgId`).
 * Question bodies + correct answers are NOT included (only a count). Each row
 * carries the caller's best pass + certification state. No active org → public
 * quizzes only.
 */
export const listQuizzes = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<QuizListItem[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    // Correlated subqueries (count/max) + a boolean-expression ORDER BY: kept on
    // the sql escape hatch through the Drizzle client (semantics-preserving).
    const db = createDb(env.DB);
    const rows = await db.all<{
      id: string;
      brand_id: string | null;
      title: string;
      description: string;
      pass_threshold: number;
      cert_name: string | null;
      on_leaderboard: number;
      question_count: number;
      best_passed: number | null;
      cert_count: number;
    }>(sql`
      SELECT q.id, q.brand_id, q.title, q.description, q.pass_threshold, q.cert_name,
             q.on_leaderboard,
             (SELECT COUNT(*) FROM questions qn WHERE qn.quiz_id = q.id) AS question_count,
             (SELECT MAX(a.passed) FROM attempts a
                WHERE a.quiz_id = q.id AND a.user_id = ${userId} AND a.status = 'submitted') AS best_passed,
             (SELECT COUNT(*) FROM certifications c
                WHERE c.quiz_id = q.id AND c.user_id = ${userId}) AS cert_count
        FROM quizzes q
       WHERE q.status = 'published'
         AND (q.brand_id IS NULL OR q.brand_id = ${brandId})
       ORDER BY (q.brand_id IS NULL) ASC, q.title ASC, q.id ASC`);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      passThreshold: r.pass_threshold,
      certName: r.cert_name,
      onLeaderboard: r.on_leaderboard !== 0,
      questionCount: r.question_count,
      isPublic: r.brand_id === null,
      passed: r.best_passed === null ? null : r.best_passed !== 0,
      certified: r.cert_count > 0,
    }));
  });

/**
 * Gated: the caller's OPEN (in-progress, un-submitted) attempts on quizzes still
 * visible to them — drives the section's Resume banner. Owner-scoped; joined to
 * the quiz for the title + only published, in-scope (public OR own-brand) quizzes.
 * The answered count is derived from the stored answers buffer (no re-grade).
 * Newest-started first.
 */
export const listOpenAttempts = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<OpenAttempt[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    // brand_id IS NULL OR brand_id = brandId (a null-org caller sees public only).
    const visibility =
      brandId === null
        ? isNull(quizzes.brandId)
        : or(isNull(quizzes.brandId), eq(quizzes.brandId, brandId));
    const rows = await db
      .select({
        attemptId: attempts.id,
        quizId: attempts.quizId,
        answersJson: attempts.answersJson,
        startedAt: attempts.startedAt,
        title: quizzes.title,
      })
      .from(attempts)
      .innerJoin(quizzes, eq(quizzes.id, attempts.quizId))
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.status, "open"),
          eq(quizzes.status, "published"),
          visibility,
        ),
      )
      .orderBy(desc(attempts.startedAt));

    if (rows.length === 0) return [];

    // Total question count per quiz (one grouped read, not a per-row subquery).
    const quizIds = [...new Set(rows.map((r) => r.quizId))];
    const counts = await db
      .select({ quizId: questions.quizId, n: count() })
      .from(questions)
      .where(inArray(questions.quizId, quizIds))
      .groupBy(questions.quizId);
    const totalByQuiz = new Map(counts.map((c) => [c.quizId, c.n] as const));

    return rows.map((r) => ({
      attemptId: r.attemptId,
      quizId: r.quizId,
      title: r.title,
      answered: Object.keys(parseAnswers(r.answersJson)).length,
      total: totalByQuiz.get(r.quizId) ?? 0,
      startedAt: r.startedAt,
    }));
  });

const quizIdInput = type({ quizId: "string >= 1" });

/** Build the `ActiveAttempt` payload for a freshly-started or resumed attempt. */
function buildActiveAttempt(
  attempt: {
    id: string;
    shuffleSeed: number;
    answersJson: string;
    currentQuestion: number;
    deadlineAt: number | null;
  },
  quiz: QuizRow,
  display: DisplayQuestion[],
): ActiveAttempt {
  return {
    attemptId: attempt.id,
    quizId: quiz.id,
    title: quiz.title,
    passThreshold: quiz.pass_threshold,
    timeLimitSeconds: quiz.time_limit_seconds,
    deadlineAt: attempt.deadlineAt,
    certName: quiz.cert_name,
    questions: redactQuestions(display, attempt.shuffleSeed),
    answers: parseAnswers(attempt.answersJson),
    currentQuestion: attempt.currentQuestion,
  };
}

/**
 * Gated: start (or resume) an attempt. If an `open` attempt already exists for
 * (user, quiz) it's resumed (idempotent re-entry); otherwise a fresh row is
 * created with a `shuffle_seed` + `max_score`, honoring `retakes_allowed` /
 * `max_attempts` (a submitted attempt blocks a retake when retakes are off or the
 * attempt cap is hit). Emits `quiz_attempt_start` on a fresh start.
 */
export const startAttempt = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(quizIdInput)
  .handler(async ({ data, context }): Promise<ActiveAttempt> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const loaded = await loadTakeableQuiz(data.quizId, brandId);
    if (!loaded) throw new Error("not_found");
    const { quiz } = loaded;

    // Resume an existing open attempt rather than stacking a second one.
    const openRow = (
      await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.userId, userId),
            eq(attempts.quizId, data.quizId),
            eq(attempts.status, "open"),
          ),
        )
        .orderBy(desc(attempts.startedAt))
        .limit(1)
    ).at(0);
    const open = openRow ? toAttemptRow(openRow) : null;
    const display = await loadDisplayQuestions(data.quizId);
    if (open) {
      return buildActiveAttempt(
        {
          id: open.id,
          shuffleSeed: open.shuffle_seed,
          answersJson: open.answers_json,
          currentQuestion: open.current_question,
          deadlineAt: open.deadline_at,
        },
        quiz,
        display,
      );
    }

    // Retake gating: count prior submitted attempts.
    const submitted = (
      await db
        .select({ n: count(), best: max(attempts.passed) })
        .from(attempts)
        .where(
          and(
            eq(attempts.userId, userId),
            eq(attempts.quizId, data.quizId),
            eq(attempts.status, "submitted"),
          ),
        )
    ).at(0);
    const priorCount = submitted?.n ?? 0;
    if (priorCount > 0) {
      if (quiz.retakes_allowed === 0) throw new Error("retakes_not_allowed");
      if (quiz.max_attempts != null && priorCount >= quiz.max_attempts) {
        throw new Error("max_attempts_reached");
      }
    }

    const now = Date.now();
    const deadlineAt =
      quiz.time_limit_seconds && quiz.time_limit_seconds > 0
        ? now + quiz.time_limit_seconds * 1000
        : now + DEFAULT_DEADLINE_MS;
    const maxScore = loaded.questions.reduce((s, q) => s + q.points, 0);
    const shuffleSeed = Math.floor(Math.random() * 2 ** 31);
    const attemptId = ulid();

    await db.insert(attempts).values({
      id: attemptId,
      brandId: quiz.brand_id,
      quizId: data.quizId,
      userId,
      shuffleSeed,
      answersJson: "{}",
      currentQuestion: 0,
      score: null,
      maxScore,
      passed: null,
      status: "open",
      startedAt: now,
      deadlineAt,
      submittedAt: null,
      timeSpentSeconds: null,
    });

    await emitEvent({
      brandId: brandId ?? quiz.brand_id ?? "",
      actorId: userId,
      type: "quiz_attempt_start",
      targetType: "quiz",
      targetId: data.quizId,
      metadata: { attemptId },
    });

    await writeAudit({
      brandId: quiz.brand_id,
      action: "attempt.start",
      actorId: userId,
      targetType: "attempt",
      targetId: attemptId,
      meta: { quizId: data.quizId },
    });

    return buildActiveAttempt(
      { id: attemptId, shuffleSeed, answersJson: "{}", currentQuestion: 0, deadlineAt },
      quiz,
      display,
    );
  });

const attemptIdInput = type({ attemptId: "string >= 1" });

/**
 * Gated: resume an open attempt — returns its saved answers + current question +
 * the REDACTED questions in the attempt's stable shuffle order. Scoped to the
 * caller (owner-only) and their brand. A submitted/foreign attempt resolves to
 * "not found".
 */
export const resumeAttempt = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(attemptIdInput)
  .handler(async ({ data, context }): Promise<ActiveAttempt | null> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const attemptRow = (
      await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.id, data.attemptId),
            eq(attempts.userId, userId),
            eq(attempts.status, "open"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!attemptRow) return null;
    const attempt = toAttemptRow(attemptRow);

    const loaded = await loadTakeableQuiz(attempt.quiz_id, brandId);
    if (!loaded) return null;
    const display = await loadDisplayQuestions(attempt.quiz_id);

    return buildActiveAttempt(
      {
        id: attempt.id,
        shuffleSeed: attempt.shuffle_seed,
        answersJson: attempt.answers_json,
        currentQuestion: attempt.current_question,
        deadlineAt: attempt.deadline_at,
      },
      loaded.quiz,
      display,
    );
  });

// The loose answer envelope — arktype validates the discriminator + question id;
// the per-type coercion (`coerceAnswer`) picks the fields each type needs.
const answerPayloadSchema = type({
  type: "'multiple_choice' | 'select_all' | 'true_false' | 'image' | 'matching'",
  questionId: "string >= 1",
  "optionId?": "string",
  "optionIds?": "string[]",
  "pairs?": type({ leftId: "string >= 1", rightId: "string >= 1" }).array(),
});

const saveProgressInput = type({
  attemptId: "string >= 1",
  answers: answerPayloadSchema.array(),
  currentQuestion: "number >= 0",
});

/**
 * Gated: autosave the learner's in-progress answers + current question onto the
 * open attempt. Owner-scoped; a no-op on a submitted/foreign attempt. Never
 * grades — `gradeAttempt` is the only path that writes scores.
 */
export const saveProgress = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(saveProgressInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const userId = context.principal.actor.id;

    const answersByQ: Record<string, AnswerPayload> = {};
    for (const a of data.answers) {
      const payload = coerceAnswer(a.questionId, a);
      if (payload) answersByQ[a.questionId] = payload;
    }

    const db = createDb(env.DB);
    await db
      .update(attempts)
      .set({ answersJson: JSON.stringify(answersByQ), currentQuestion: data.currentQuestion })
      .where(
        and(
          eq(attempts.id, data.attemptId),
          eq(attempts.userId, userId),
          eq(attempts.status, "open"),
        ),
      );

    return { ok: true };
  });

const gradeAttemptInput = type({
  attemptId: "string >= 1",
  answers: answerPayloadSchema.array(),
});

/**
 * Gated: server-side grade + finalize an open attempt. Re-grades against the
 * authored questions/options via `lib/grading` (the client NEVER sends a score),
 * freezes per-question awarded points into `attempt_answers` (immutable), stamps
 * `score`/`passed`/`submitted_at` on the attempt, and emits `quiz_attempt_submit`.
 * A pass on a cert quiz inserts a `certifications` row
 * `ON CONFLICT(brand_id,user_id,quiz_id) DO NOTHING` + emits `cert_awarded`.
 * Always enqueues `attempt.completed` (leaderboard re-index) — best-effort.
 */
export const gradeAttempt = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(gradeAttemptInput)
  .handler(async ({ data, context }): Promise<AttemptResultView> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const attemptRow = (
      await db.select().from(attempts).where(eq(attempts.id, data.attemptId)).limit(1)
    ).at(0);
    if (!attemptRow) throw new Error("not_found");
    const attempt = toAttemptRow(attemptRow);
    if (attempt.user_id !== userId) throw new Error("forbidden");
    if (attempt.status !== "open") throw new Error("already_submitted");

    const loaded = await loadTakeableQuiz(attempt.quiz_id, brandId);
    if (!loaded) throw new Error("not_found");
    const { quiz, questions } = loaded;
    // Display rows (prompt + option/right text + explanation) for the result
    // breakdown — graded once below, never re-graded on the result read.
    const display = await loadDisplayQuestions(attempt.quiz_id);

    // Build the answers map from input, ignoring answers for unknown questions.
    const known = new Set(questions.map((q) => q.id));
    const answersByQ = new Map<string, AnswerPayload>();
    for (const a of data.answers) {
      if (!known.has(a.questionId)) continue;
      const payload = coerceAnswer(a.questionId, a);
      if (payload) answersByQ.set(a.questionId, payload);
    }

    const graded = gradeAttemptPure(questions, answersByQ);
    const passed = graded.passed(quiz.pass_threshold);
    const now = Date.now();
    const timeSpentSeconds = Math.max(0, Math.round((now - attempt.started_at) / 1000));

    // Freeze per-question awarded points (immutable). D1 bindings have no
    // multi-stmt transaction; the attempt UPDATE is the last write, so a re-submit
    // finds status='open' until it lands.
    for (const pq of graded.perQuestion) {
      const payload = answersByQ.get(pq.questionId) ?? null;
      await db.insert(attemptAnswers).values({
        id: ulid(),
        attemptId: data.attemptId,
        questionId: pq.questionId,
        payloadJson: JSON.stringify(payload),
        isCorrect: pq.isCorrect ? 1 : 0,
        pointsAwarded: pq.pointsAwarded,
      });
    }

    await db
      .update(attempts)
      .set({
        status: "submitted",
        submittedAt: now,
        score: graded.score,
        maxScore: graded.maxScore,
        passed: passed ? 1 : 0,
        timeSpentSeconds,
      })
      .where(eq(attempts.id, data.attemptId));

    // Certification: brand-scoped cert quizzes only. brand_id is the attempt's
    // (= quiz's) brand; a public cert quiz (brand_id NULL) is skipped because the
    // certifications table requires a non-null brand_id.
    let certified = false;
    if (passed && quiz.cert_name && quiz.brand_id) {
      const certId = ulid();
      const inserted = await db
        .insert(certifications)
        .values({
          id: certId,
          brandId: quiz.brand_id,
          quizId: quiz.id,
          userId,
          name: quiz.cert_name,
          attemptId: data.attemptId,
          awardedAt: now,
        })
        .onConflictDoNothing({
          target: [certifications.brandId, certifications.userId, certifications.quizId],
        })
        .returning({ id: certifications.id });
      if (inserted.length > 0) {
        certified = true;
        await emitEvent({
          brandId: quiz.brand_id,
          actorId: userId,
          type: "cert_awarded",
          targetType: "quiz",
          targetId: quiz.id,
          metadata: { certName: quiz.cert_name, attemptId: data.attemptId },
        });
      } else {
        // Already certified from an earlier pass — surface as certified, no event.
        certified = true;
      }
    }

    await emitEvent({
      brandId: brandId ?? quiz.brand_id ?? "",
      actorId: userId,
      type: "quiz_attempt_submit",
      targetType: "quiz",
      targetId: quiz.id,
      metadata: {
        attemptId: data.attemptId,
        score: graded.score,
        maxScore: graded.maxScore,
        passed,
      },
    });

    await writeAudit({
      brandId: quiz.brand_id,
      action: "attempt.submit",
      actorId: userId,
      targetType: "attempt",
      targetId: data.attemptId,
      meta: { quizId: quiz.id, score: graded.score, maxScore: graded.maxScore, passed, certified },
    });

    // Fire-and-forget leaderboard re-index. The audit row is the durable signal.
    try {
      await env.SPROUT_JOBS_QUEUE.send({
        kind: "attempt.completed",
        attemptId: data.attemptId,
        userId,
        brandId: quiz.brand_id,
        quizId: quiz.id,
        score: graded.score,
        maxScore: graded.maxScore,
        passed,
      });
    } catch (err) {
      console.error("[quizzes.gradeAttempt] queue enqueue failed", err);
    }

    const percent = graded.maxScore > 0 ? Math.round((graded.score / graded.maxScore) * 100) : 0;

    // Surface the per-question breakdown from the SAME grade just frozen above —
    // no second grading pass. The frozen map is the in-memory `graded.perQuestion`
    // (questionId → isCorrect/pointsAwarded) joined to the submitted payloads.
    const frozen = new Map<string, FrozenAnswer>(
      graded.perQuestion.map((pq) => [
        pq.questionId,
        {
          payload: answersByQ.get(pq.questionId) ?? null,
          isCorrect: pq.isCorrect,
          pointsAwarded: pq.pointsAwarded,
        },
      ]),
    );
    const perQuestion = buildPerQuestion(display, questions, frozen, attempt.shuffle_seed);

    return {
      attemptId: data.attemptId,
      quizId: quiz.id,
      score: graded.score,
      maxScore: graded.maxScore,
      percent,
      passed,
      certName: quiz.cert_name,
      certified,
      perQuestion,
    };
  });

/**
 * Gated: the IMMUTABLE result read for a finished attempt — re-renders the graded
 * result from the frozen `attempt_answers` rows (never re-grades). Owner-scoped;
 * a foreign or still-open attempt resolves to null. Used to re-show a result the
 * learner already submitted (e.g. re-opening the section after a pass) and to
 * surface the per-question breakdown without re-running the grader.
 */
export const getAttemptResult = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(attemptIdInput)
  .handler(async ({ data, context }): Promise<AttemptResultView | null> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const attemptRow = (
      await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.id, data.attemptId),
            eq(attempts.userId, userId),
            eq(attempts.status, "submitted"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!attemptRow) return null;
    const attempt = toAttemptRow(attemptRow);

    const loaded = await loadTakeableQuiz(attempt.quiz_id, brandId);
    if (!loaded) return null;
    const { quiz, questions } = loaded;
    const display = await loadDisplayQuestions(attempt.quiz_id);

    // The frozen per-question grades — read verbatim from attempt_answers, the
    // immutable post-submit record. The stored payloadJson is the learner's own
    // submission; isCorrect/pointsAwarded are the points frozen at submit.
    const frozenRows = await db
      .select()
      .from(attemptAnswers)
      .where(eq(attemptAnswers.attemptId, data.attemptId));
    const frozen = new Map<string, FrozenAnswer>();
    for (const row of frozenRows) {
      let payload: AnswerPayload | null = null;
      try {
        const parsed = JSON.parse(row.payloadJson) as unknown;
        payload = parsed === null ? null : coerceAnswer(row.questionId, parsed);
      } catch {
        payload = null;
      }
      frozen.set(row.questionId, {
        payload,
        isCorrect: row.isCorrect !== 0,
        pointsAwarded: row.pointsAwarded,
      });
    }

    const perQuestion = buildPerQuestion(display, questions, frozen, attempt.shuffle_seed);
    const score = attempt.score ?? 0;
    const maxScore = attempt.max_score;
    const percent = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;
    const passed = attempt.passed === 1;

    // Certified state mirrors gradeAttempt: a brand-scoped cert quiz the learner
    // holds a certification row for.
    let certified = false;
    if (quiz.cert_name && quiz.brand_id) {
      const certRow = (
        await db
          .select({ id: certifications.id })
          .from(certifications)
          .where(
            and(
              eq(certifications.brandId, quiz.brand_id),
              eq(certifications.userId, userId),
              eq(certifications.quizId, quiz.id),
            ),
          )
          .limit(1)
      ).at(0);
      certified = certRow !== undefined;
    }

    return {
      attemptId: attempt.id,
      quizId: quiz.id,
      score,
      maxScore,
      percent,
      passed,
      certName: quiz.cert_name,
      certified,
      perQuestion,
    };
  });

/**
 * Gated: the caller's earned certifications across their active brand — drives the
 * persistent badge list in the Quizzes section header. Owner + brand scoped:
 * certifications are always brand-scoped (the table requires a non-null brand_id),
 * so a null-org caller has none. Newest award first.
 */
export const listMyCertifications = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<EarnedCertification[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const rows = await db
      .select({
        quizId: certifications.quizId,
        name: certifications.name,
        awardedAt: certifications.awardedAt,
      })
      .from(certifications)
      .where(and(eq(certifications.userId, userId), eq(certifications.brandId, brandId)))
      .orderBy(desc(certifications.awardedAt));

    return rows.map((r) => ({ quizId: r.quizId, name: r.name, awardedAt: r.awardedAt }));
  });

// ─── admin builder (brand-role gated, in-handler decideBrandAdmin) ──────────

/** Verify a quiz belongs to `brandId`; throw "not_found" otherwise. */
async function loadOwnedQuiz(quizId: string, brandId: string): Promise<QuizRow> {
  const db = createDb(env.DB);
  const row = (
    await db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.brandId, brandId)))
      .limit(1)
  ).at(0);
  if (!row) throw new Error("not_found");
  return toQuizRow(row);
}

/** The admin builder's view of a quiz + its full (UN-redacted) questions. */
export interface AdminQuiz {
  id: string;
  title: string;
  description: string;
  passThreshold: number;
  retakesAllowed: boolean;
  maxAttempts: number | null;
  timeLimitSeconds: number | null;
  certName: string | null;
  onLeaderboard: boolean;
  shuffleQuestions: boolean;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface AdminQuestion {
  id: string;
  quizId: string;
  orderIdx: number;
  type: QuestionType;
  prompt: string;
  imageRef: string | null;
  points: number;
  explanation: string | null;
  config: MatchingConfig;
  options: AdminOption[];
}

export interface AdminOption {
  id: string;
  questionId: string;
  orderIdx: number;
  text: string;
  imageRef: string | null;
  isCorrect: boolean;
  weight: number;
  right: string | null;
}

export interface AdminQuizBundle {
  quizzes: AdminQuiz[];
}

function mapAdminQuiz(row: QuizRow): AdminQuiz {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    passThreshold: row.pass_threshold,
    retakesAllowed: row.retakes_allowed !== 0,
    maxAttempts: row.max_attempts,
    timeLimitSeconds: row.time_limit_seconds,
    certName: row.cert_name,
    onLeaderboard: row.on_leaderboard !== 0,
    shuffleQuestions: row.shuffle_questions !== 0,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Admin: every quiz the caller's brand owns (incl. drafts), newest-first.
 * Brand-role gated so a plain budtender can't enumerate drafts. brand =
 * envelope `activeOrgId`, never input.
 */
export const listAdminQuizzes = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminQuiz[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.brandId, brandId))
      .orderBy(desc(quizzes.createdAt), desc(quizzes.id));
    return rows.map((r) => mapAdminQuiz(toQuizRow(r)));
  });

/**
 * Admin: a single quiz + its full UN-redacted questions/options (the builder's
 * source of truth — correct flags + weights + matching rights are visible here,
 * for authors only). brand-role gated; brand-scoped.
 */
export const getAdminQuiz = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(quizIdInput)
  .handler(
    async ({ data, context }): Promise<{ quiz: AdminQuiz; questions: AdminQuestion[] } | null> => {
      const brandId = context.brand.id; // authorized viewed brand, non-null
      await assertBrandAdmin(brandId, context.principal.actor.role);

      const db = createDb(env.DB);
      const quizRow = (
        await db
          .select()
          .from(quizzes)
          .where(and(eq(quizzes.id, data.quizId), eq(quizzes.brandId, brandId)))
          .limit(1)
      ).at(0);
      if (!quizRow) return null;

      const qs = await db
        .select()
        .from(questions)
        .where(eq(questions.quizId, data.quizId))
        .orderBy(questions.orderIdx, questions.createdAt);

      const optRows = await db
        .select({ opt: questionOptions })
        .from(questionOptions)
        .innerJoin(questions, eq(questions.id, questionOptions.questionId))
        .where(eq(questions.quizId, data.quizId))
        .orderBy(questionOptions.questionId, questionOptions.orderIdx);
      const byQ = new Map<string, AdminOption[]>();
      for (const { opt: o } of optRows) {
        const arr = byQ.get(o.questionId) ?? [];
        arr.push({
          id: o.id,
          questionId: o.questionId,
          orderIdx: o.orderIdx,
          text: o.text,
          imageRef: o.imageRef,
          isCorrect: o.isCorrect !== 0,
          weight: o.weight,
          right: parseOptionConfig(o.configJson).right ?? null,
        });
        byQ.set(o.questionId, arr);
      }

      const adminQuestions: AdminQuestion[] = qs.map((q) => {
        const t = asQuestionType(q.type);
        return {
          id: q.id,
          quizId: q.quizId,
          orderIdx: q.orderIdx,
          type: t,
          prompt: q.prompt,
          imageRef: q.imageRef,
          points: q.points,
          explanation: q.explanation,
          config: t === "matching" ? parseMatchingConfig(q.configJson) : {},
          options: byQ.get(q.id) ?? [],
        };
      });

      return { quiz: mapAdminQuiz(toQuizRow(quizRow)), questions: adminQuestions };
    },
  );

const upsertQuizInput = type({
  "id?": "string >= 1",
  title: "string >= 1",
  "description?": "string <= 600",
  passThreshold: "number >= 0",
  retakesAllowed: "boolean",
  "maxAttempts?": "number >= 1",
  "timeLimitSeconds?": "number >= 0",
  "certName?": "string <= 120",
  onLeaderboard: "boolean",
  shuffleQuestions: "boolean",
});

/**
 * Admin: create or edit a quiz's settings (NOT its questions). brand =
 * envelope `activeOrgId`, never input — admin quizzes are always brand-scoped.
 * Editing checks ownership via the `brand_id` guard. Brand-Admin gated; audited.
 */
export const upsertQuiz = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertQuizInput)
  .handler(async ({ data, context }): Promise<{ quizId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const now = Date.now();
    const description = data.description ?? "";
    const certName = data.certName?.trim() ? data.certName.trim() : null;
    const maxAttempts = data.maxAttempts ?? null;
    const timeLimitSeconds =
      data.timeLimitSeconds && data.timeLimitSeconds > 0 ? data.timeLimitSeconds : null;

    const db = createDb(env.DB);
    if (data.id) {
      await loadOwnedQuiz(data.id, brandId);
      await db
        .update(quizzes)
        .set({
          title: data.title,
          description,
          passThreshold: data.passThreshold,
          retakesAllowed: data.retakesAllowed ? 1 : 0,
          maxAttempts,
          timeLimitSeconds,
          certName,
          onLeaderboard: data.onLeaderboard ? 1 : 0,
          shuffleQuestions: data.shuffleQuestions ? 1 : 0,
          updatedAt: now,
        })
        .where(and(eq(quizzes.id, data.id), eq(quizzes.brandId, brandId)));

      await writeAudit({
        brandId,
        action: "quiz.upsert",
        actorId,
        targetType: "quiz",
        targetId: data.id,
        meta: { title: data.title, certName, edit: true },
      });
      return { quizId: data.id };
    }

    const quizId = ulid();
    await db.insert(quizzes).values({
      id: quizId,
      brandId,
      title: data.title,
      description,
      passThreshold: data.passThreshold,
      retakesAllowed: data.retakesAllowed ? 1 : 0,
      maxAttempts,
      timeLimitSeconds,
      certName,
      onLeaderboard: data.onLeaderboard ? 1 : 0,
      shuffleQuestions: data.shuffleQuestions ? 1 : 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      createdBy: actorId,
    });

    await writeAudit({
      brandId,
      action: "quiz.upsert",
      actorId,
      targetType: "quiz",
      targetId: quizId,
      meta: { title: data.title, certName, edit: false },
    });
    return { quizId };
  });

const optionDraftSchema = type({
  "id?": "string >= 1",
  text: "string",
  "imageRef?": "string",
  isCorrect: "boolean",
  "weight?": "number >= 0",
  "right?": "string",
});

const upsertQuestionInput = type({
  quizId: "string >= 1",
  "id?": "string >= 1",
  type: "'multiple_choice' | 'select_all' | 'true_false' | 'image' | 'matching'",
  prompt: "string >= 1",
  "imageRef?": "string",
  "points?": "number >= 0",
  "explanation?": "string <= 600",
  options: optionDraftSchema.array(),
});

/**
 * Admin: create or edit a question + replace its full option set in one write.
 * `matching` rights live in each option's `config_json` ({ right }) AND the
 * question's `config_json` ({ pairs: [{ leftId, rightText }] }) so the grader can
 * resolve pairs without a second query. Ownership flows through the quiz's
 * `brand_id` guard. Brand-Admin gated; audited.
 */
export const upsertQuestion = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertQuestionInput)
  .handler(async ({ data, context }): Promise<{ questionId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    // Ownership: the question's quiz must be this brand's.
    await loadOwnedQuiz(data.quizId, brandId);

    const now = Date.now();
    const points = data.points && data.points > 0 ? data.points : 1;
    const explanation = data.explanation?.trim() ? data.explanation.trim() : null;
    const imageRef = data.imageRef?.trim() ? data.imageRef.trim() : null;

    // Materialize option ids up front so matching pairs can reference them.
    const optionRows = data.options.map((o) => ({
      id: o.id ?? ulid(),
      text: o.text,
      imageRef: o.imageRef?.trim() ? o.imageRef.trim() : null,
      isCorrect: o.isCorrect,
      weight: o.weight ?? 1,
      right: o.right ?? "",
    }));

    // matching: build the question-level pairs map (leftId → rightText) from the
    // options' own right values so grading + redaction share one source.
    const questionConfig =
      data.type === "matching"
        ? JSON.stringify({
            type: "matching",
            pairs: optionRows.map((o) => ({ leftId: o.id, rightText: o.right })),
          })
        : "{}";

    const db = createDb(env.DB);
    let questionId = data.id;
    if (questionId) {
      const owned = (
        await db
          .select({ id: questions.id })
          .from(questions)
          .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
          .where(
            and(
              eq(questions.id, questionId),
              eq(questions.quizId, data.quizId),
              eq(quizzes.brandId, brandId),
            ),
          )
          .limit(1)
      ).at(0);
      if (!owned) throw new Error("not_found");

      await db
        .update(questions)
        .set({
          type: data.type,
          prompt: data.prompt,
          imageRef,
          points,
          explanation,
          configJson: questionConfig,
          updatedAt: now,
        })
        .where(eq(questions.id, questionId));
      // Replace the option set wholesale (the form sends the full list).
      await db.delete(questionOptions).where(eq(questionOptions.questionId, questionId));
    } else {
      // Append after the current max order_idx for the quiz.
      const maxOrder = (
        await db
          .select({ m: sql<number>`COALESCE(MAX(${questions.orderIdx}), -1)` })
          .from(questions)
          .where(eq(questions.quizId, data.quizId))
      ).at(0);
      const orderIdx = (maxOrder?.m ?? -1) + 1;
      questionId = ulid();
      await db.insert(questions).values({
        id: questionId,
        quizId: data.quizId,
        orderIdx,
        type: data.type,
        prompt: data.prompt,
        imageRef,
        points,
        explanation,
        configJson: questionConfig,
        createdAt: now,
        updatedAt: now,
      });
    }

    for (let i = 0; i < optionRows.length; i++) {
      const o = optionRows[i]!;
      const optConfig = data.type === "matching" ? JSON.stringify({ right: o.right }) : "{}";
      await db.insert(questionOptions).values({
        id: o.id,
        questionId,
        orderIdx: i,
        text: o.text,
        imageRef: o.imageRef,
        isCorrect: o.isCorrect ? 1 : 0,
        weight: o.weight,
        configJson: optConfig,
      });
    }

    // Bump the quiz's updated_at so the builder list reflects the edit.
    await db
      .update(quizzes)
      .set({ updatedAt: now })
      .where(and(eq(quizzes.id, data.quizId), eq(quizzes.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "question.upsert",
      actorId,
      targetType: "question",
      targetId: questionId,
      meta: { quizId: data.quizId, type: data.type, options: optionRows.length },
    });

    return { questionId };
  });

/**
 * Admin: upsert a SINGLE option (convenience for inline option edits — the bulk
 * path is `upsertQuestion`). Ownership flows through the option's question →
 * quiz → brand_id chain. Brand-Admin gated; audited.
 */
export const upsertOption = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(
    type({
      questionId: "string >= 1",
      "id?": "string >= 1",
      text: "string",
      "imageRef?": "string",
      isCorrect: "boolean",
      "weight?": "number >= 0",
      "right?": "string",
    }),
  )
  .handler(async ({ data, context }): Promise<{ optionId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    // Ownership: question → quiz → this brand.
    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: questions.id, type: questions.type })
        .from(questions)
        .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
        .where(and(eq(questions.id, data.questionId), eq(quizzes.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    const imageRef = data.imageRef?.trim() ? data.imageRef.trim() : null;
    const weight = data.weight ?? 1;
    const optConfig =
      owned.type === "matching" ? JSON.stringify({ right: data.right ?? "" }) : "{}";

    let optionId = data.id;
    if (optionId) {
      await db
        .update(questionOptions)
        .set({
          text: data.text,
          imageRef,
          isCorrect: data.isCorrect ? 1 : 0,
          weight,
          configJson: optConfig,
        })
        .where(
          and(eq(questionOptions.id, optionId), eq(questionOptions.questionId, data.questionId)),
        );
    } else {
      const maxOrder = (
        await db
          .select({ m: sql<number>`COALESCE(MAX(${questionOptions.orderIdx}), -1)` })
          .from(questionOptions)
          .where(eq(questionOptions.questionId, data.questionId))
      ).at(0);
      optionId = ulid();
      await db.insert(questionOptions).values({
        id: optionId,
        questionId: data.questionId,
        orderIdx: (maxOrder?.m ?? -1) + 1,
        text: data.text,
        imageRef,
        isCorrect: data.isCorrect ? 1 : 0,
        weight,
        configJson: optConfig,
      });
    }

    await writeAudit({
      brandId,
      action: "option.upsert",
      actorId,
      targetType: "option",
      targetId: optionId,
      meta: { questionId: data.questionId },
    });

    return { optionId };
  });

const deleteQuestionInput = type({ questionId: "string >= 1" });

/**
 * Admin: hard-delete a question (its options cascade). Ownership flows through
 * the question → quiz → brand_id chain. Brand-Admin gated; audited.
 */
export const deleteQuestion = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(deleteQuestionInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: questions.id, quizId: questions.quizId })
        .from(questions)
        .innerJoin(quizzes, eq(quizzes.id, questions.quizId))
        .where(and(eq(questions.id, data.questionId), eq(quizzes.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    await db.delete(questions).where(eq(questions.id, data.questionId));
    await db
      .update(quizzes)
      .set({ updatedAt: Date.now() })
      .where(and(eq(quizzes.id, owned.quizId), eq(quizzes.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "question.delete",
      actorId,
      targetType: "question",
      targetId: data.questionId,
      meta: { quizId: owned.quizId },
    });

    return { ok: true };
  });

const publishQuizInput = type({ quizId: "string >= 1", publish: "boolean" });

/**
 * Admin: flip a quiz between draft and published. Publishing requires at least
 * one question (an empty quiz is un-takeable). brand-scoped; audited.
 */
export const publishQuiz = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(publishQuizInput)
  .handler(async ({ data, context }): Promise<{ ok: true; status: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    await loadOwnedQuiz(data.quizId, brandId);

    const db = createDb(env.DB);
    if (data.publish) {
      const countRow = (
        await db.select({ n: count() }).from(questions).where(eq(questions.quizId, data.quizId))
      ).at(0);
      if ((countRow?.n ?? 0) === 0) throw new Error("no_questions");
    }

    const status = data.publish ? "published" : "draft";
    await db
      .update(quizzes)
      .set({ status, updatedAt: Date.now() })
      .where(and(eq(quizzes.id, data.quizId), eq(quizzes.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "quiz.publish",
      actorId,
      targetType: "quiz",
      targetId: data.quizId,
      meta: { status },
    });

    return { ok: true, status };
  });
