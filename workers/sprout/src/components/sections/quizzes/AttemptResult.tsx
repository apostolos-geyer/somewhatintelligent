import { Award, CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import type { AttemptResultView, PerQuestionResult } from "@/lib/quizzes.functions";

/**
 * The graded result screen for a finished attempt. Shows pass/fail, the score +
 * percent, and — when the quiz is a certification quiz the learner passed — the
 * awarded cert badge. Below the summary, a PER-QUESTION breakdown surfaced from
 * the IMMUTABLE `attempt_answers` freeze (never re-graded): each row marks
 * correct/incorrect with text + icon (not colour alone), and every WRONG answer
 * reveals the authored correct answer + the Brand-Admin explanation. Pass offers
 * nothing more; fail offers a retry (the section gates retry on the quiz's
 * `retakes_allowed`, so this just signals intent).
 */
export function AttemptResult({
  result,
  onRetry,
  onBack,
  retryAllowed,
}: {
  result: AttemptResultView;
  onRetry: () => void;
  onBack: () => void;
  retryAllowed: boolean;
}) {
  const { passed, score, maxScore, percent, certName, certified, perQuestion } = result;
  const correctCount = perQuestion.filter((q) => q.isCorrect).length;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Card className={cn("space-y-6 p-6 text-center sm:p-8", surfaceMaterials.brutal)}>
        <div className="flex flex-col items-center gap-3">
          {passed ? (
            <CheckCircle2 className="size-14 text-success" aria-hidden />
          ) : (
            <XCircle className="size-14 text-destructive" aria-hidden />
          )}
          <h2 className="font-display text-2xl font-bold">{passed ? "Passed" : "Not passed"}</h2>
          <p className="text-sm text-muted-foreground">
            You scored <strong className="text-foreground">{formatScore(score)}</strong> of{" "}
            {formatScore(maxScore)} ({percent}%)
          </p>
          {perQuestion.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {correctCount} of {perQuestion.length} question
              {perQuestion.length === 1 ? "" : "s"} correct
            </p>
          )}
        </div>

        {passed && certName && certified && (
          <div className="flex flex-col items-center gap-2 rounded-sm border border-primary/30 bg-primary/5 px-4 py-5">
            <Award className="size-8 text-primary" aria-hidden />
            <p className="text-sm font-medium">Certification earned</p>
            <Badge variant="soft">{certName}</Badge>
          </div>
        )}

        <div className="flex items-center justify-center gap-3">
          <Button type="button" variant="outline" onClick={onBack}>
            Back to quizzes
          </Button>
          {!passed && retryAllowed && (
            <Button type="button" variant="default" onClick={onRetry}>
              <RotateCcw className="size-4" aria-hidden />
              Try again
            </Button>
          )}
        </div>
      </Card>

      {perQuestion.length > 0 && (
        <section className="space-y-3" aria-label="Per-question breakdown">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Review your answers
          </h3>
          <ol className="space-y-3">
            {perQuestion.map((q, i) => (
              <QuestionBreakdown key={q.questionId} result={q} index={i} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/**
 * One question's graded row. Correct rows stay collapsed to the prompt + a "+pts"
 * marker; INCORRECT rows expand to show the learner's submitted answer, the
 * authored correct answer, and — when present — the Brand-Admin explanation.
 * Correctness is conveyed by an icon + label, never colour alone (a11y).
 */
function QuestionBreakdown({ result, index }: { result: PerQuestionResult; index: number }) {
  const { isCorrect, prompt, points, pointsAwarded, yourAnswer, correctAnswer, explanation } =
    result;
  return (
    <li>
      <Card className={cn("space-y-3 p-4", surfaceMaterials.brutal)}>
        <div className="flex items-start gap-3">
          {isCorrect ? (
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
          ) : (
            <XCircle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
          )}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Question {index + 1} · {isCorrect ? "Correct" : "Incorrect"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatScore(pointsAwarded)}/{formatScore(points)} pt
                {points === 1 ? "" : "s"}
              </span>
            </div>
            <p className="text-sm font-medium leading-relaxed">{prompt}</p>
          </div>
        </div>

        {!isCorrect && (
          <div className="space-y-2 border-t border-border/60 pt-3 pl-8 text-sm">
            <AnswerLine
              label="Your answer"
              values={yourAnswer}
              emptyText="No answer"
              variant="danger"
            />
            <AnswerLine label="Correct answer" values={correctAnswer} variant="soft" />
            {explanation && (
              <div className="rounded-sm bg-muted/50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Why
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-foreground">{explanation}</p>
              </div>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

/** A labelled answer line — renders each label value as a Badge chip. */
function AnswerLine({
  label,
  values,
  emptyText,
  variant,
}: {
  label: string;
  values: string[];
  emptyText?: string;
  variant: "danger" | "soft";
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {values.length === 0 ? (
        <span className="text-sm italic text-muted-foreground">{emptyText ?? "—"}</span>
      ) : (
        values.map((v, i) => (
          <Badge key={`${v}-${i}`} variant={variant} size="sm">
            {v}
          </Badge>
        ))
      )}
    </div>
  );
}

/** Trim trailing `.0` from partial-credit scores so "3" shows over "3.0". */
function formatScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
}
