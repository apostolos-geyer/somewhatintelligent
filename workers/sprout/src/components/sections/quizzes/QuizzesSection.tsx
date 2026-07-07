import { useEffect, useMemo, useRef, useState } from "react";
import { Award, Check, GraduationCap, Loader2, Play, Trophy } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@greenroom/ui/components/tabs";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { usePortalContext } from "@/components/shell/portal-context";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import { getLeaderboard } from "@/lib/hub.functions";
import { LeaderboardTable } from "@/components/hub/LeaderboardTable";
import {
  gradeAttempt,
  listMyCertifications,
  listOpenAttempts,
  listQuizzes,
  resumeAttempt,
  saveProgress,
  startAttempt,
  type ActiveAttempt,
  type AnswerPayload,
  type AttemptResultView,
  type EarnedCertification,
  type OpenAttempt,
  type PublicQuestion,
  type QuizListItem,
} from "@/lib/quizzes.functions";
import { QuestionCard } from "./QuestionCard";
import { AttemptResult } from "./AttemptResult";

/**
 * The Quizzes section (03) — rendered full-screen inside the SectionLayer via the
 * registry (no props). A Tabs header switches between:
 *
 *  - Quizzes — the brand-scoped + public quiz list and the take-flow phase
 *    machine (intro → active → review → result). Autosave
 *    fires on every answer (with a "saving…" indicator); one
 *    question at a time; a review screen lists answered/unanswered before submit;
 *    the result shows the score/pass, the per-question breakdown, and any earned
 *    certification. Earned certifications also persist as a header badge list, and
 *    an open (in-progress) attempt surfaces a Resume banner.
 *  - Leaderboard — the brand-scoped composite-score table (owned by the
 *    Leaderboard stream's `getLeaderboard` + `LeaderboardTable`), with a period
 *    selector.
 *
 * An `?item=<quizId>` deep-link auto-starts that quiz's take-flow.
 */
export function QuizzesSection() {
  const { brand } = usePortalContext();
  const { item, setItem } = useLayerStack();

  return (
    <div className="mx-auto max-w-3xl">
      <Tabs defaultValue="quizzes">
        <TabsList className="mb-6">
          <TabsTrigger value="quizzes">
            <GraduationCap className="size-4" aria-hidden />
            Quizzes
          </TabsTrigger>
          <TabsTrigger value="leaderboard">
            <Trophy className="size-4" aria-hidden />
            Leaderboard
          </TabsTrigger>
        </TabsList>

        <TabsContent value="quizzes">
          <QuizzesTab
            brandKey={brand?.orgId ?? null}
            deepLink={item}
            onClearDeepLink={() => setItem(undefined)}
          />
        </TabsContent>

        <TabsContent value="leaderboard">
          <LeaderboardTab brandKey={brand?.orgId ?? null} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Quizzes tab — list + take-flow phase machine ───────────────────────────

type Phase =
  | { kind: "list" }
  | { kind: "intro"; quiz: QuizListItem }
  | { kind: "active"; quiz: QuizListItem; attempt: ActiveAttempt }
  | { kind: "review"; quiz: QuizListItem; attempt: ActiveAttempt }
  | { kind: "result"; quiz: QuizListItem; result: AttemptResultView };

function QuizzesTab({
  brandKey,
  deepLink,
  onClearDeepLink,
}: {
  brandKey: string | null;
  deepLink: string | null;
  onClearDeepLink: () => void;
}) {
  const [quizzes, setQuizzes] = useState<QuizListItem[] | null>(null);
  const [certifications, setCertifications] = useState<EarnedCertification[]>([]);
  const [openAttempts, setOpenAttempts] = useState<OpenAttempt[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "list" });
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState<string | null>(null);
  const deepLinkHandled = useRef(false);

  async function refreshList() {
    try {
      const [list, certs, open] = await Promise.all([
        listQuizzes(),
        listMyCertifications(),
        listOpenAttempts(),
      ]);
      setQuizzes(list);
      setCertifications(certs);
      setOpenAttempts(open);
    } catch {
      setQuizzes((prev) => prev ?? []);
    }
  }

  useEffect(() => {
    void refreshList();
  }, [brandKey]);

  // Auto-start the deep-linked quiz once the list resolves.
  useEffect(() => {
    if (deepLinkHandled.current || !deepLink || !quizzes) return;
    const target = quizzes.find((q) => q.id === deepLink);
    if (target) {
      deepLinkHandled.current = true;
      void beginAttempt(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, quizzes]);

  async function beginAttempt(quiz: QuizListItem) {
    setError(null);
    try {
      const attempt = await startAttempt({ data: { quizId: quiz.id } });
      setPhase({ kind: "active", quiz, attempt });
    } catch (e) {
      setError(humanizeError(e));
      setPhase({ kind: "intro", quiz });
    }
  }

  // Resume an open attempt in place — re-hydrates the saved answers + cursor.
  async function resume(open: OpenAttempt) {
    setError(null);
    setResuming(open.attemptId);
    try {
      const attempt = await resumeAttempt({ data: { attemptId: open.attemptId } });
      if (!attempt) {
        // The attempt vanished (submitted/expired elsewhere) — refresh and bail.
        await refreshList();
        return;
      }
      const quiz = quizzes?.find((q) => q.id === attempt.quizId) ?? {
        id: attempt.quizId,
        title: attempt.title,
        description: "",
        passThreshold: attempt.passThreshold,
        certName: attempt.certName,
        onLeaderboard: false,
        questionCount: attempt.questions.length,
        isPublic: false,
        passed: null,
        certified: false,
      };
      setPhase({ kind: "active", quiz, attempt });
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setResuming(null);
    }
  }

  function backToList() {
    onClearDeepLink();
    deepLinkHandled.current = false;
    setPhase({ kind: "list" });
    void refreshList();
  }

  if (phase.kind === "intro") {
    return (
      <QuizIntro
        quiz={phase.quiz}
        onStart={() => void beginAttempt(phase.quiz)}
        onBack={backToList}
        error={error}
      />
    );
  }

  if (phase.kind === "active" || phase.kind === "review") {
    return (
      <ActiveAttemptView
        quiz={phase.quiz}
        attempt={phase.attempt}
        phase={phase.kind}
        onReview={() => setPhase({ kind: "review", quiz: phase.quiz, attempt: phase.attempt })}
        onResumeTaking={() =>
          setPhase({ kind: "active", quiz: phase.quiz, attempt: phase.attempt })
        }
        onSubmitted={(result) => setPhase({ kind: "result", quiz: phase.quiz, result })}
        onError={setError}
        error={error}
      />
    );
  }

  if (phase.kind === "result") {
    return (
      <AttemptResult
        result={phase.result}
        retryAllowed={phase.result.passed ? false : !phase.quiz.passed}
        onRetry={() => void beginAttempt(phase.quiz)}
        onBack={backToList}
      />
    );
  }

  // ── list ──
  if (quizzes === null) {
    return (
      <div className="grid grid-cols-1 gap-grid sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {certifications.length > 0 && <CertificationStrip certifications={certifications} />}

      {openAttempts.length > 0 && (
        <ResumeBanner attempts={openAttempts} resuming={resuming} onResume={resume} />
      )}

      {error && phase.kind === "list" && <p className="text-sm text-destructive">{error}</p>}

      {quizzes.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
          <GraduationCap className="size-10 text-muted-foreground" aria-hidden />
          <h3 className="font-display text-lg font-bold">No quizzes yet</h3>
          <p className="text-sm text-muted-foreground">
            Earn certifications and climb the leaderboard once quizzes are published.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-grid sm:grid-cols-2">
          {quizzes.map((quiz) => (
            <QuizCard key={quiz.id} quiz={quiz} onOpen={() => setPhase({ kind: "intro", quiz })} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The persistent earned-certification badge list shown in the section header — the
 * durable surface for a budtender's certifications (not only the transient result
 * card). Reads `listMyCertifications` (brand-scoped, owner-scoped).
 */
function CertificationStrip({ certifications }: { certifications: EarnedCertification[] }) {
  return (
    <section
      className={cn("space-y-2 rounded-sm p-4", surfaceMaterials.brutal)}
      aria-label="Your certifications"
    >
      <div className="flex items-center gap-2">
        <Award className="size-4 text-primary" aria-hidden />
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your certifications
        </h3>
      </div>
      <ul className="flex flex-wrap gap-2">
        {certifications.map((c) => (
          <li key={`${c.quizId}-${c.awardedAt}`}>
            <Badge variant="soft">
              <Award className="size-3.5" aria-hidden />
              {c.name}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Resume banner for in-progress attempts — closing mid-quiz resumes here. */
function ResumeBanner({
  attempts,
  resuming,
  onResume,
}: {
  attempts: OpenAttempt[];
  resuming: string | null;
  onResume: (open: OpenAttempt) => void;
}) {
  return (
    <section className="space-y-2" aria-label="Resume an in-progress quiz">
      {attempts.map((a) => {
        const busy = resuming === a.attemptId;
        return (
          <Card
            key={a.attemptId}
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 border-primary/30 bg-primary/5 p-4",
              surfaceMaterials.brutal,
            )}
          >
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-semibold">In progress · {a.title}</p>
              <p className="text-xs text-muted-foreground">
                {a.answered} of {a.total} answered — pick up where you left off
              </p>
            </div>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={busy || resuming !== null}
              onClick={() => onResume(a)}
              aria-label={`Resume ${a.title}`}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              Resume
            </Button>
          </Card>
        );
      })}
    </section>
  );
}

function QuizCard({ quiz, onOpen }: { quiz: QuizListItem; onOpen: () => void }) {
  return (
    <Card className={cn("flex flex-col gap-3 p-5", surfaceMaterials.brutal)}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-bold leading-tight">{quiz.title}</h3>
        {quiz.certified && <Award className="size-5 shrink-0 text-primary" aria-hidden />}
      </div>
      {quiz.description && (
        <p className="line-clamp-2 text-sm text-muted-foreground">{quiz.description}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">
          {quiz.questionCount} question{quiz.questionCount === 1 ? "" : "s"}
        </Badge>
        {quiz.certName && <Badge variant="info">{quiz.certName}</Badge>}
        {quiz.passed === true && <Badge variant="soft">Passed</Badge>}
        {quiz.isPublic && <Badge variant="secondary">Public</Badge>}
      </div>
      <Button type="button" variant="default" size="sm" className="mt-auto w-full" onClick={onOpen}>
        {quiz.passed === true ? "Retake" : "Start"}
      </Button>
    </Card>
  );
}

function QuizIntro({
  quiz,
  onStart,
  onBack,
  error,
}: {
  quiz: QuizListItem;
  onStart: () => void;
  onBack: () => void;
  error: string | null;
}) {
  const [starting, setStarting] = useState(false);
  return (
    <Card className={cn("mx-auto max-w-lg space-y-5 p-6 sm:p-8", surfaceMaterials.brutal)}>
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold">{quiz.title}</h2>
        {quiz.description && <p className="text-sm text-muted-foreground">{quiz.description}</p>}
      </div>
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li>
          {quiz.questionCount} question{quiz.questionCount === 1 ? "" : "s"} · pass at{" "}
          {quiz.passThreshold}%
        </li>
        {quiz.certName && (
          <li className="flex items-center gap-1.5">
            <Award className="size-4 text-primary" aria-hidden />
            Earns the {quiz.certName} certification
          </li>
        )}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={starting}
          onClick={() => {
            setStarting(true);
            onStart();
          }}
        >
          {starting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Start quiz
        </Button>
      </div>
    </Card>
  );
}

/**
 * The active take-flow — one question at a time, autosaving every answer (+ the
 * current question index) so a reload resumes where the learner left off. A
 * "saving…" indicator shows while an autosave is in flight. The last question's
 * primary action advances to a REVIEW screen (answered/unanswered with jump-back)
 * rather than submitting directly; Submit grades server-side from the review.
 */
function ActiveAttemptView({
  quiz,
  attempt,
  phase,
  onReview,
  onResumeTaking,
  onSubmitted,
  onError,
  error,
}: {
  quiz: QuizListItem;
  attempt: ActiveAttempt;
  phase: "active" | "review";
  onReview: () => void;
  onResumeTaking: () => void;
  onSubmitted: (result: AttemptResultView) => void;
  onError: (msg: string | null) => void;
  error: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerPayload>>(attempt.answers);
  const [current, setCurrent] = useState(
    Math.min(attempt.currentQuestion, Math.max(0, attempt.questions.length - 1)),
  );
  const [submitting, setSubmitting] = useState(false);
  // In-flight autosave count — a positive count drives the "saving…" indicator.
  const [savingCount, setSavingCount] = useState(0);

  const total = attempt.questions.length;
  const question = attempt.questions[current];
  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  function persist(nextAnswers: Record<string, AnswerPayload>, nextCurrent: number) {
    setSavingCount((n) => n + 1);
    void saveProgress({
      data: {
        attemptId: attempt.attemptId,
        answers: Object.values(nextAnswers),
        currentQuestion: nextCurrent,
      },
    })
      .catch(() => {
        // autosave is best-effort — submit re-sends the full answer set anyway.
      })
      .finally(() => {
        setSavingCount((n) => Math.max(0, n - 1));
      });
  }

  function onAnswer(payload: AnswerPayload) {
    setAnswers((prev) => {
      const next = { ...prev, [payload.questionId]: payload };
      persist(next, current);
      return next;
    });
  }

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(total - 1, next));
    setCurrent(clamped);
    persist(answers, clamped);
  }

  // Jump back to a specific question from the review screen, re-entering taking.
  function jumpTo(index: number) {
    const clamped = Math.max(0, Math.min(total - 1, index));
    setCurrent(clamped);
    persist(answers, clamped);
    onResumeTaking();
  }

  async function submit() {
    setSubmitting(true);
    onError(null);
    try {
      const result = await gradeAttempt({
        data: { attemptId: attempt.attemptId, answers: Object.values(answers) },
      });
      onSubmitted(result);
    } catch (e) {
      onError(humanizeError(e));
      setSubmitting(false);
    }
  }

  if (!question) {
    return <p className="text-sm text-muted-foreground">This quiz has no questions.</p>;
  }

  const saving = savingCount > 0;

  if (phase === "review") {
    return (
      <ReviewScreen
        quiz={quiz}
        questions={attempt.questions}
        answers={answers}
        answeredCount={answeredCount}
        total={total}
        saving={saving}
        submitting={submitting}
        error={error}
        onJumpTo={jumpTo}
        onBack={onResumeTaking}
        onSubmit={() => void submit()}
      />
    );
  }

  const isLast = current === total - 1;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">{quiz.title}</h2>
          <SavingIndicator saving={saving} />
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={current + 1}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-label={`Question ${current + 1} of ${total}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${total > 0 ? ((current + 1) / total) * 100 : 0}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {answeredCount} of {total} answered
        </p>
      </header>

      <QuestionCard
        key={question.id}
        question={question}
        index={current}
        total={total}
        current={answers[question.id]}
        onChange={onAnswer}
      />

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={current === 0 || submitting}
          onClick={() => goTo(current - 1)}
        >
          Previous
        </Button>
        {isLast ? (
          <Button type="button" variant="default" disabled={submitting} onClick={onReview}>
            Review answers
          </Button>
        ) : (
          <Button
            type="button"
            variant="default"
            disabled={submitting}
            onClick={() => goTo(current + 1)}
          >
            Next
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The pre-submit review screen — lists every question with its answered/unanswered
 * state and a jump-back affordance, plus the submit action. Surfaces unanswered
 * questions prominently so nothing is missed before grading.
 */
function ReviewScreen({
  quiz,
  questions,
  answers,
  answeredCount,
  total,
  saving,
  submitting,
  error,
  onJumpTo,
  onBack,
  onSubmit,
}: {
  quiz: QuizListItem;
  questions: PublicQuestion[];
  answers: Record<string, AnswerPayload>;
  answeredCount: number;
  total: number;
  saving: boolean;
  submitting: boolean;
  error: string | null;
  onJumpTo: (index: number) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const unanswered = total - answeredCount;
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-xl font-bold">Review your answers</h2>
          <SavingIndicator saving={saving} />
        </div>
        <p className="text-sm text-muted-foreground">
          {answeredCount} of {total} answered
          {unanswered > 0 ? (
            <>
              {" "}
              · <span className="font-medium text-foreground">{unanswered} still unanswered</span>
            </>
          ) : (
            " · all questions answered"
          )}
        </p>
      </header>

      <Card className={cn("divide-y divide-border/60", surfaceMaterials.brutal)}>
        <ol>
          {questions.map((q, i) => {
            const isAnswered = answers[q.id] !== undefined;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => onJumpTo(i)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent"
                  aria-label={`Question ${i + 1}, ${isAnswered ? "answered" : "unanswered"} — jump to edit`}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{q.prompt}</span>
                  {isAnswered ? (
                    <Badge variant="soft" size="sm">
                      <Check className="size-3.5" aria-hidden />
                      Answered
                    </Badge>
                  ) : (
                    <Badge variant="warn" size="sm">
                      Unanswered
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      </Card>

      {quiz.certName && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Award className="size-4 text-primary" aria-hidden />
          Passing earns the {quiz.certName} certification.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between">
        <Button type="button" variant="outline" disabled={submitting} onClick={onBack}>
          Back to questions
        </Button>
        <Button type="button" variant="default" disabled={submitting} onClick={onSubmit}>
          {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitting ? "Grading…" : "Submit quiz"}
        </Button>
      </div>
    </div>
  );
}

/** The autosave "saving…" indicator — quiet, polite, never blocks input. */
function SavingIndicator({ saving }: { saving: boolean }) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-opacity",
        saving ? "opacity-100" : "opacity-0",
      )}
      aria-live="polite"
    >
      {saving && (
        <>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Saving…
        </>
      )}
    </span>
  );
}

// ─── Leaderboard tab — brand-scoped composite score + period selector ───────

/** Recent months for the period selector ("YYYY-MM"), newest first. */
function recentPeriods(count: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < count; i++) {
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    out.push(`${year}-${month}`);
    d.setUTCMonth(d.getUTCMonth() - 1);
  }
  return out;
}

function LeaderboardTab({ brandKey }: { brandKey: string | null }) {
  const periods = useMemo(() => recentPeriods(6), []);
  const [period, setPeriod] = useState(periods[0] ?? "");
  const [data, setData] = useState<Awaited<ReturnType<typeof getLeaderboard>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    void (async () => {
      try {
        const res = await getLeaderboard({ data: { period } });
        if (!cancelled) setData(res);
      } catch {
        if (!cancelled) setData({ period, entries: [], ownRank: null, ownScore: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [period, brandKey]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Learning leaderboard
        </h3>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="rounded-sm border border-border bg-background px-2 py-1.5 text-sm"
          aria-label="Leaderboard period"
        >
          {periods.map((p) => (
            <option key={p} value={p}>
              {formatPeriod(p)}
            </option>
          ))}
        </select>
      </div>

      {data === null ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-sm" />
          ))}
        </div>
      ) : (
        <LeaderboardTable entries={data.entries} ownRank={data.ownRank} period={data.period} />
      )}
    </div>
  );
}

/** "2026-06" → "June 2026". */
function formatPeriod(period: string): string {
  const [year, month] = period.split("-");
  const idx = Number(month) - 1;
  const names = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return idx >= 0 && idx < 12 ? `${names[idx]} ${year}` : period;
}

// ─── shared ─────────────────────────────────────────────────────────────────

/** Map known server-fn error messages to budtender-friendly copy. */
function humanizeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  switch (msg) {
    case "retakes_not_allowed":
      return "This quiz doesn't allow retakes.";
    case "max_attempts_reached":
      return "You've used all your attempts for this quiz.";
    case "not_found":
      return "This quiz isn't available.";
    case "already_submitted":
      return "This attempt was already submitted.";
    default:
      return "Something went wrong. Please try again.";
  }
}
