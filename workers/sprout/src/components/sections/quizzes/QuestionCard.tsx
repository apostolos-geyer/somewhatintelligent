import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import type { AnswerPayload, PublicQuestion } from "@/lib/quizzes.functions";

/**
 * One question in the take-flow, rendered per-type. PURELY controlled — the
 * `current` answer + `onChange` live in the owning `QuizzesSection` so autosave
 * sees every keystroke. Correct answers are never present in the payload (the
 * server redacts them), so this component can't leak them.
 *
 *   multiple_choice / true_false / image  → radios (single pick; image shows the
 *                                            option's image_ref as a labelled tile)
 *   select_all                            → checkboxes (multi pick)
 *   matching                              → left rows each with a <select> of the
 *                                            server-shuffled right values
 */
export function QuestionCard({
  question,
  index,
  total,
  current,
  onChange,
}: {
  question: PublicQuestion;
  index: number;
  total: number;
  current: AnswerPayload | undefined;
  onChange: (payload: AnswerPayload) => void;
}) {
  return (
    <Card className={cn("space-y-4 p-5", surfaceMaterials.brutal)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Question {index + 1} of {total}
        </span>
        <span className="text-xs text-muted-foreground">
          {question.points} pt{question.points === 1 ? "" : "s"}
        </span>
      </div>

      {question.imageRef && (
        <div className="overflow-hidden rounded-sm border border-border">
          <img src={question.imageRef} alt="" className="max-h-64 w-full object-contain" />
        </div>
      )}

      <p className="font-medium leading-relaxed">{question.prompt}</p>

      {(question.type === "multiple_choice" ||
        question.type === "true_false" ||
        question.type === "image") && (
        <SingleChoice question={question} current={current} onChange={onChange} />
      )}

      {question.type === "select_all" && (
        <MultiChoice question={question} current={current} onChange={onChange} />
      )}

      {question.type === "matching" && (
        <Matching question={question} current={current} onChange={onChange} />
      )}
    </Card>
  );
}

// ─── single-choice (multiple_choice / true_false / image) ───────────────────

function SingleChoice({
  question,
  current,
  onChange,
}: {
  question: Extract<PublicQuestion, { type: "multiple_choice" | "true_false" | "image" }>;
  current: AnswerPayload | undefined;
  onChange: (payload: AnswerPayload) => void;
}) {
  const selected =
    current &&
    (current.type === "multiple_choice" ||
      current.type === "true_false" ||
      current.type === "image")
      ? current.optionId
      : null;

  const isImage = question.type === "image";

  return (
    <ul className={cn(isImage ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "space-y-2")}>
      {question.options.map((o) => {
        const checked = selected === o.id;
        return (
          <li key={o.id}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 transition-colors",
                checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
                isImage && "flex-col items-stretch p-2",
              )}
            >
              {isImage && o.imageRef && (
                <img src={o.imageRef} alt="" className="h-24 w-full rounded-sm object-cover" />
              )}
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`q-${question.id}`}
                  className="shrink-0"
                  checked={checked}
                  onChange={() =>
                    onChange({ type: question.type, questionId: question.id, optionId: o.id })
                  }
                />
                <span className="text-sm">{o.text}</span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// ─── select_all (multi-choice, weighted partial credit) ─────────────────────

function MultiChoice({
  question,
  current,
  onChange,
}: {
  question: Extract<PublicQuestion, { type: "select_all" }>;
  current: AnswerPayload | undefined;
  onChange: (payload: AnswerPayload) => void;
}) {
  const selected = new Set(current && current.type === "select_all" ? current.optionIds : []);

  function toggle(optionId: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(optionId);
    else next.delete(optionId);
    onChange({ type: "select_all", questionId: question.id, optionIds: [...next] });
  }

  return (
    <ul className="space-y-2">
      {question.options.map((o) => {
        const checked = selected.has(o.id);
        return (
          <li key={o.id}>
            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-sm border px-3 py-2 transition-colors",
                checked ? "border-primary bg-primary/5" : "border-border hover:bg-accent",
              )}
            >
              <input
                type="checkbox"
                className="shrink-0"
                checked={checked}
                onChange={(e) => toggle(o.id, e.target.checked)}
              />
              <span className="text-sm">{o.text}</span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

// ─── matching (left rows, server-shuffled right <select>) ───────────────────

function Matching({
  question,
  current,
  onChange,
}: {
  question: Extract<PublicQuestion, { type: "matching" }>;
  current: AnswerPayload | undefined;
  onChange: (payload: AnswerPayload) => void;
}) {
  const pairs: Array<{ leftId: string; rightId: string }> =
    current && current.type === "matching" ? current.pairs : [];
  const pickedByLeft = new Map(pairs.map((p) => [p.leftId, p.rightId] as const));

  function setPair(leftId: string, rightId: string) {
    const next = pairs.filter((p) => p.leftId !== leftId);
    if (rightId) next.push({ leftId, rightId });
    onChange({ type: "matching", questionId: question.id, pairs: next });
  }

  return (
    <ul className="space-y-2">
      {question.lefts.map((l) => {
        const selected = pickedByLeft.get(l.id) ?? "";
        return (
          <li key={l.id} className="flex items-center gap-3">
            <span className="flex-1 text-sm">{l.text}</span>
            <select
              value={selected}
              onChange={(e) => setPair(l.id, e.target.value)}
              className="rounded-sm border border-border bg-background px-2 py-1.5 text-sm"
            >
              <option value="" disabled>
                Select…
              </option>
              {question.rights.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.text}
                </option>
              ))}
            </select>
          </li>
        );
      })}
    </ul>
  );
}
