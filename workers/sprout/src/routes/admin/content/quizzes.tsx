import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { type } from "arktype";
import { CheckCircle2, Eye, Loader2, Plus, Trash2 } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  deleteQuestion,
  getAdminQuiz,
  listAdminQuizzes,
  publishQuiz,
  upsertQuestion,
  upsertQuiz,
  type AdminQuestion,
  type AdminQuiz,
} from "@/lib/quizzes.functions";
import type { QuestionType } from "@/lib/grading";

/**
 * Brand-Admin quiz builder (P2.D). Nests under the pathless `admin.tsx` guard,
 * SELF-CONTAINED. Server-side: every mutation is brand-role gated
 * (`decideBrandAdmin`) and `brand_id` is the envelope's activeOrgId, never sent.
 *
 * Left rail = the brand's quizzes (settings + publish); right = the selected
 * quiz's questions, each composed with a per-type `useAppForm` (no raw JSON). A
 * live preview mirrors what the budtender sees (with correct answers marked, for
 * the author only).
 */
export const Route = createFileRoute("/admin/content/quizzes")({
  loader: () => listAdminQuizzes(),
  component: AdminQuizzesPage,
});

const QUESTION_TYPE_OPTIONS: Array<{ value: QuestionType; label: string }> = [
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "true_false", label: "True / False" },
  { value: "select_all", label: "Select all (partial credit)" },
  { value: "image", label: "Image choice" },
  { value: "matching", label: "Matching" },
];

const TYPE_LABEL: Record<QuestionType, string> = {
  multiple_choice: "Multiple choice",
  true_false: "True / False",
  select_all: "Select all",
  image: "Image choice",
  matching: "Matching",
};

function AdminQuizzesPage() {
  const quizzes = Route.useLoaderData();
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && quizzes.length > 0) setSelectedId(quizzes[0]!.id);
  }, [quizzes, selectedId]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Quizzes</h1>
        <p className="text-sm text-muted-foreground">
          Build certification quizzes and leaderboard challenges for your budtenders.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-3">
          <NewQuizForm
            onCreated={(quizId) => {
              setSelectedId(quizId);
              void router.invalidate();
            }}
          />
          {quizzes.map((quiz) => (
            <button
              key={quiz.id}
              type="button"
              onClick={() => setSelectedId(quiz.id)}
              className={cn(
                "w-full rounded-sm border px-3 py-2 text-left transition-colors",
                quiz.id === selectedId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent",
              )}
            >
              <p className="truncate text-sm font-medium">{quiz.title}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <Badge variant={quiz.status === "published" ? "soft" : "warn"}>
                  {quiz.status === "published" ? "Live" : "Draft"}
                </Badge>
                {quiz.certName && <Badge variant="info">Cert</Badge>}
              </div>
            </button>
          ))}
          {quizzes.length === 0 && (
            <p className="text-sm text-muted-foreground">No quizzes yet. Create one above.</p>
          )}
        </aside>

        <section className="min-w-0">
          {selectedId ? (
            <QuizEditor
              key={selectedId}
              quizId={selectedId}
              onChanged={() => void router.invalidate()}
            />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Select a quiz to edit, or create a new one.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── new quiz ───────────────────────────────────────────────────────────────

const newQuizSchema = type({ title: "string >= 1" });

function NewQuizForm({ onCreated }: { onCreated: (quizId: string) => void }) {
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { title: "" },
    validators: { onBlur: newQuizSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        const res = await upsertQuiz({
          data: {
            title: value.title.trim(),
            passThreshold: 80,
            retakesAllowed: true,
            onLeaderboard: true,
            shuffleQuestions: true,
          },
        });
        formApi.reset();
        onCreated(res.quizId);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create quiz.");
      }
    },
  });

  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.AppField name="title">
        {(field) => <field.TextField label="New quiz" placeholder="Product knowledge quiz" />}
      </form.AppField>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <form.AppForm>
        <form.SubmitButton label="Create" loadingLabel="Creating…" size="sm" />
      </form.AppForm>
    </form>
  );
}

// ─── quiz editor (settings + questions + preview) ───────────────────────────

function QuizEditor({ quizId, onChanged }: { quizId: string; onChanged: () => void }) {
  const [data, setData] = useState<{ quiz: AdminQuiz; questions: AdminQuestion[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  async function refresh() {
    try {
      setData(await getAdminQuiz({ data: { quizId } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quiz.");
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  if (data === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-sm" />
        <Skeleton className="h-24 w-full rounded-sm" />
      </div>
    );
  }

  const { quiz, questions } = data;

  return (
    <div className="space-y-6">
      <QuizSettingsPanel
        quiz={quiz}
        questionCount={questions.length}
        onSaved={() => {
          void refresh();
          onChanged();
        }}
      />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Questions
          </h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPreview((v) => !v)}
            disabled={questions.length === 0}
          >
            <Eye className="size-4" aria-hidden />
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
        </div>

        {showPreview && <QuizPreview questions={questions} />}

        {questions.length === 0 && (
          <p className="text-sm text-muted-foreground">No questions yet. Add one below.</p>
        )}

        <ul className="space-y-2">
          {questions.map((q, i) => (
            <QuestionRow
              key={q.id}
              quizId={quizId}
              question={q}
              index={i}
              onChanged={() => {
                void refresh();
                onChanged();
              }}
            />
          ))}
        </ul>

        <NewQuestionForm
          quizId={quizId}
          onCreated={() => {
            void refresh();
            onChanged();
          }}
        />
      </section>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ─── quiz settings ──────────────────────────────────────────────────────────

const settingsSchema = type({
  title: "string >= 1",
  description: "string",
  passThreshold: "string",
  timeLimitMinutes: "string",
  maxAttempts: "string",
  certName: "string",
  retakesAllowed: "boolean",
  onLeaderboard: "boolean",
  shuffleQuestions: "boolean",
});

function QuizSettingsPanel({
  quiz,
  questionCount,
  onSaved,
}: {
  quiz: AdminQuiz;
  questionCount: number;
  onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);

  const form = useAppForm({
    defaultValues: {
      title: quiz.title,
      description: quiz.description,
      passThreshold: String(quiz.passThreshold),
      timeLimitMinutes: String(quiz.timeLimitSeconds ? Math.round(quiz.timeLimitSeconds / 60) : 0),
      maxAttempts: quiz.maxAttempts != null ? String(quiz.maxAttempts) : "",
      certName: quiz.certName ?? "",
      retakesAllowed: quiz.retakesAllowed,
      onLeaderboard: quiz.onLeaderboard,
      shuffleQuestions: quiz.shuffleQuestions,
    },
    validators: { onBlur: settingsSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const timeLimitMinutes = Number(value.timeLimitMinutes);
        const maxAttempts = value.maxAttempts.trim() ? Number(value.maxAttempts.trim()) : undefined;
        await upsertQuiz({
          data: {
            id: quiz.id,
            title: value.title.trim(),
            description: value.description.trim(),
            passThreshold: Number(value.passThreshold) || 0,
            ...(timeLimitMinutes > 0 ? { timeLimitSeconds: timeLimitMinutes * 60 } : {}),
            ...(maxAttempts && maxAttempts >= 1 ? { maxAttempts } : {}),
            ...(value.certName.trim() ? { certName: value.certName.trim() } : {}),
            retakesAllowed: value.retakesAllowed,
            onLeaderboard: value.onLeaderboard,
            shuffleQuestions: value.shuffleQuestions,
          },
        });
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    },
  });

  async function togglePublish() {
    setPublishing(true);
    setError(null);
    try {
      await publishQuiz({ data: { quizId: quiz.id, publish: quiz.status !== "published" } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Card className={cn("p-4 md:p-5", surfaceMaterials.brutal)}>
      <CardHeader className="flex-row items-start justify-between gap-3 p-0">
        <div className="min-w-0">
          <CardTitle className="text-base">Settings</CardTitle>
          <CardDescription>Pass mark, retakes, timing, and certification.</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={quiz.status === "published" ? "soft" : "warn"}>
            {quiz.status === "published" ? "Live" : "Draft"}
          </Badge>
          <Button
            type="button"
            variant={quiz.status === "published" ? "outline" : "default"}
            size="sm"
            disabled={publishing}
            onClick={() => void togglePublish()}
          >
            {publishing ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="size-4" aria-hidden />
            )}
            {quiz.status === "published" ? "Unpublish" : "Publish"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 pt-4">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>
          <form.AppField name="description">
            {(field) => <field.TextareaField label="Description" rows={2} />}
          </form.AppField>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <form.AppField name="passThreshold">
              {(field) => <field.TextField label="Pass %" type="text" />}
            </form.AppField>
            <form.AppField name="timeLimitMinutes">
              {(field) => <field.TextField label="Time limit (min, 0 = none)" type="text" />}
            </form.AppField>
            <form.AppField name="maxAttempts">
              {(field) => <field.TextField label="Max attempts (blank = ∞)" type="text" />}
            </form.AppField>
          </div>

          <form.AppField name="certName">
            {(field) => (
              <field.TextField
                label="Certification name (blank = no cert)"
                placeholder="Certified Budtender"
                description="Passing awards this named certification badge."
              />
            )}
          </form.AppField>

          <div className="flex flex-wrap gap-6">
            <form.AppField name="retakesAllowed">
              {(field) => <field.SwitchField label="Allow retakes" size="sm" />}
            </form.AppField>
            <form.AppField name="onLeaderboard">
              {(field) => <field.SwitchField label="Counts toward leaderboard" size="sm" />}
            </form.AppField>
            <form.AppField name="shuffleQuestions">
              {(field) => <field.SwitchField label="Shuffle questions" size="sm" />}
            </form.AppField>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {quiz.status === "published" && questionCount === 0 && (
            <p className="text-xs text-warning-ink">
              This quiz is published but has no questions — add one so it's takeable.
            </p>
          )}

          <form.AppForm>
            <form.SubmitButton label="Save settings" loadingLabel="Saving…" size="sm" />
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}

// ─── question row + composer ────────────────────────────────────────────────

function QuestionRow({
  quizId,
  question,
  index,
  onChanged,
}: {
  quizId: string;
  question: AdminQuestion;
  index: number;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <li>
        <QuestionForm
          quizId={quizId}
          initial={question}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      </li>
    );
  }

  async function onDelete() {
    if (!confirm("Delete this question?")) return;
    setBusy(true);
    try {
      await deleteQuestion({ data: { questionId: question.id } });
      onChanged();
    } catch {
      setBusy(false);
    }
  }

  return (
    <li className={cn("space-y-2 p-3", surfaceMaterials.brutal)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">#{index + 1}</span>
            <Badge variant="outline">{TYPE_LABEL[question.type]}</Badge>
            <span className="text-xs text-muted-foreground">
              {question.points} pt{question.points === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1 font-medium">{question.prompt}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void onDelete()}
            aria-label="Delete question"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
      <ul className="ml-4 list-disc text-sm">
        {question.options.map((o) => (
          <li key={o.id} className={o.isCorrect ? "text-success" : "text-foreground/80"}>
            {o.isCorrect ? "✓ " : ""}
            {o.text}
            {question.type === "matching" && o.right ? ` → ${o.right}` : ""}
            {question.type === "select_all" && o.isCorrect ? ` (weight ${o.weight})` : ""}
          </li>
        ))}
      </ul>
    </li>
  );
}

function NewQuestionForm({ quizId, onCreated }: { quizId: string; onCreated: () => void }) {
  const [seq, setSeq] = useState(0);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Add question
      </Button>
    );
  }

  return (
    <QuestionForm
      key={seq}
      quizId={quizId}
      initial={null}
      onCancel={() => setOpen(false)}
      onSaved={() => {
        setSeq((n) => n + 1);
        onCreated();
      }}
    />
  );
}

interface OptionDraft {
  text: string;
  isCorrect: boolean;
  /** select_all weighted partial credit. */
  weight: string;
  /** matching right-side value. */
  right: string;
}

interface QuestionFormValues {
  type: QuestionType;
  prompt: string;
  imageRef: string;
  points: string;
  explanation: string;
  options: OptionDraft[];
}

const TYPES_NO_OPTIONS: ReadonlySet<QuestionType> = new Set();

function defaultOptions(type: QuestionType): OptionDraft[] {
  if (type === "true_false") {
    return [
      { text: "True", isCorrect: true, weight: "1", right: "" },
      { text: "False", isCorrect: false, weight: "1", right: "" },
    ];
  }
  return [
    { text: "", isCorrect: false, weight: "1", right: "" },
    { text: "", isCorrect: false, weight: "1", right: "" },
  ];
}

function QuestionForm({
  quizId,
  initial,
  onSaved,
  onCancel,
}: {
  quizId: string;
  initial: AdminQuestion | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const seededTypeRef = useRef<QuestionType>(initial?.type ?? "multiple_choice");
  const initialType: QuestionType = initial?.type ?? "multiple_choice";

  const form = useAppForm({
    defaultValues: {
      type: initialType,
      prompt: initial?.prompt ?? "",
      imageRef: initial?.imageRef ?? "",
      points: String(initial?.points ?? 1),
      explanation: initial?.explanation ?? "",
      options: initial
        ? initial.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            weight: String(o.weight),
            right: o.right ?? "",
          }))
        : defaultOptions(initialType),
    } satisfies QuestionFormValues,
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await upsertQuestion({
          data: {
            quizId,
            ...(initial?.id ? { id: initial.id } : {}),
            type: value.type,
            prompt: value.prompt.trim(),
            ...(value.imageRef.trim() ? { imageRef: value.imageRef.trim() } : {}),
            points: Number(value.points) || 1,
            ...(value.explanation.trim() ? { explanation: value.explanation.trim() } : {}),
            options: value.options.map((o) => ({
              text: o.text.trim(),
              isCorrect: o.isCorrect,
              ...(value.type === "select_all" ? { weight: Number(o.weight) || 1 } : {}),
              ...(value.type === "matching" ? { right: o.right.trim() } : {}),
            })),
          },
        });
        onSaved();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    },
  });

  function pickSingleCorrect(idx: number, currentOptions: OptionDraft[]) {
    form.setFieldValue(
      "options",
      currentOptions.map((o, i) => ({ ...o, isCorrect: i === idx })),
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
      className={cn("space-y-3 p-4", surfaceMaterials.brutal)}
      aria-label={initial ? "edit question" : "new question"}
    >
      <h3 className="text-xs uppercase tracking-wide text-muted-foreground">
        {initial ? "Edit question" : "Add question"}
      </h3>

      {/* Reset the option shape when the type changes on a NEW question. */}
      <form.Subscribe selector={(s) => s.values.type}>
        {(type) => (
          <TypeChangeReset
            type={type}
            isNew={!initial}
            seededTypeRef={seededTypeRef}
            onReset={(t) => form.setFieldValue("options", defaultOptions(t))}
          />
        )}
      </form.Subscribe>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[180px_1fr_90px]">
        <form.AppField name="type">
          {(field) => <field.SelectField label="Type" options={QUESTION_TYPE_OPTIONS} />}
        </form.AppField>
        <form.AppField name="prompt">
          {(field) => <field.TextareaField label="Prompt" rows={2} placeholder="Question prompt" />}
        </form.AppField>
        <form.AppField name="points">
          {(field) => <field.TextField label="Points" type="text" />}
        </form.AppField>
      </div>

      {/* image questions reference an image by its roadie ref. */}
      <form.Subscribe selector={(s) => s.values.type}>
        {(type) =>
          type === "image" ? (
            <form.AppField name="imageRef">
              {(field) => (
                <field.TextField
                  label="Prompt image (roadie ref)"
                  description="Optional image shown above the choices."
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>

      <form.AppField name="explanation">
        {(field) => (
          <field.TextareaField
            label="Explanation (optional)"
            rows={2}
            placeholder="Shown after grading."
          />
        )}
      </form.AppField>

      {/* Per-type options editor. */}
      <form.Subscribe selector={(s) => ({ type: s.values.type, options: s.values.options })}>
        {({ type, options }) => {
          if (TYPES_NO_OPTIONS.has(type)) return null;
          if (type === "matching") {
            return (
              <form.Field name="options" mode="array">
                {(arrayField) => (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Each row is a (left, right) pair. The right column is shuffled when shown.
                    </p>
                    {options.map((_, i) => (
                      <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                        <form.Field name={`options[${i}].text` as const}>
                          {(sub) => (
                            <input
                              className="rounded-sm border border-border bg-background px-2 py-1 text-sm"
                              placeholder={`left ${i + 1}`}
                              value={sub.state.value}
                              onChange={(e) => sub.handleChange(e.target.value)}
                              onBlur={sub.handleBlur}
                            />
                          )}
                        </form.Field>
                        <form.Field name={`options[${i}].right` as const}>
                          {(sub) => (
                            <input
                              className="rounded-sm border border-border bg-background px-2 py-1 text-sm"
                              placeholder={`right ${i + 1}`}
                              value={sub.state.value}
                              onChange={(e) => sub.handleChange(e.target.value)}
                              onBlur={sub.handleBlur}
                            />
                          )}
                        </form.Field>
                        {options.length > 2 ? (
                          <RemoveButton onClick={() => arrayField.removeValue(i)} />
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                    <AddOptionButton
                      onClick={() =>
                        arrayField.pushValue({ text: "", isCorrect: false, weight: "1", right: "" })
                      }
                      label="Add pair"
                    />
                  </div>
                )}
              </form.Field>
            );
          }
          // Choice-style: multiple_choice / true_false / image / select_all.
          const isMulti = type === "select_all";
          return (
            <form.Field name="options" mode="array">
              {(arrayField) => (
                <div className="space-y-2">
                  {options.map((o, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {isMulti ? (
                        <form.Field name={`options[${i}].isCorrect` as const}>
                          {(sub) => (
                            <input
                              type="checkbox"
                              checked={sub.state.value}
                              onChange={(e) => sub.handleChange(e.target.checked)}
                              title="Correct"
                            />
                          )}
                        </form.Field>
                      ) : (
                        <input
                          type="radio"
                          name={`correct-${initial?.id ?? "new"}`}
                          checked={o.isCorrect}
                          onChange={() => pickSingleCorrect(i, options)}
                          title="Mark as correct"
                        />
                      )}
                      <form.Field name={`options[${i}].text` as const}>
                        {(sub) => (
                          <input
                            className="min-w-[8rem] flex-1 rounded-sm border border-border bg-background px-2 py-1 text-sm"
                            placeholder={type === "true_false" ? "label" : `option ${i + 1}`}
                            value={sub.state.value}
                            onChange={(e) => sub.handleChange(e.target.value)}
                            onBlur={sub.handleBlur}
                            readOnly={type === "true_false"}
                          />
                        )}
                      </form.Field>
                      {type === "image" && (
                        <form.Field name={`options[${i}].right` as const}>
                          {(sub) => (
                            <input
                              className="w-40 rounded-sm border border-border bg-background px-2 py-1 text-sm"
                              placeholder="image ref"
                              value={sub.state.value}
                              onChange={(e) => sub.handleChange(e.target.value)}
                              onBlur={sub.handleBlur}
                            />
                          )}
                        </form.Field>
                      )}
                      {isMulti && (
                        <form.Field name={`options[${i}].weight` as const}>
                          {(sub) => (
                            <input
                              className="w-16 rounded-sm border border-border bg-background px-2 py-1 text-sm"
                              placeholder="wt"
                              value={sub.state.value}
                              onChange={(e) => sub.handleChange(e.target.value)}
                              onBlur={sub.handleBlur}
                              aria-label={`weight for option ${i + 1}`}
                            />
                          )}
                        </form.Field>
                      )}
                      {type !== "true_false" && options.length > 2 && (
                        <RemoveButton onClick={() => arrayField.removeValue(i)} />
                      )}
                    </div>
                  ))}
                  {type !== "true_false" && (
                    <AddOptionButton
                      onClick={() =>
                        arrayField.pushValue({ text: "", isCorrect: false, weight: "1", right: "" })
                      }
                      label={`Add option (${isMulti ? "✓ marks correct" : "● marks correct"})`}
                    />
                  )}
                </div>
              )}
            </form.Field>
          );
        }}
      </form.Subscribe>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <form.Subscribe
        selector={(s) => ({ isSubmitting: s.isSubmitting, promptTrimmed: s.values.prompt.trim() })}
      >
        {({ isSubmitting, promptTrimmed }) => (
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSubmitting || !promptTrimmed}
            >
              {isSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {initial ? "Save" : "Add question"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
      </form.Subscribe>
    </form>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="text-xs text-destructive hover:underline"
      onClick={onClick}
      aria-label="Remove"
    >
      ✕
    </button>
  );
}

function AddOptionButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="text-xs underline" onClick={onClick}>
      + {label}
    </button>
  );
}

/**
 * Side-effect bridge: when the type changes on a NEW question, reset the options
 * array to that type's default shape. Rendered under a `form.Subscribe` so it
 * receives the freshest type.
 */
function TypeChangeReset({
  type,
  isNew,
  seededTypeRef,
  onReset,
}: {
  type: QuestionType;
  isNew: boolean;
  seededTypeRef: React.RefObject<QuestionType>;
  onReset: (t: QuestionType) => void;
}) {
  useEffect(() => {
    if (!isNew) return;
    if (type === seededTypeRef.current) return;
    seededTypeRef.current = type;
    onReset(type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
  return null;
}

// ─── preview (author-facing; correct answers marked) ────────────────────────

function QuizPreview({ questions }: { questions: AdminQuestion[] }) {
  return (
    <Card className={cn("space-y-4 p-4", surfaceMaterials.glass)}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Preview · correct answers marked (authors only)
      </p>
      {questions.map((q, i) => (
        <div key={q.id} className="space-y-1.5 border-b border-border pb-3 last:border-0 last:pb-0">
          <p className="text-sm font-medium">
            {i + 1}. {q.prompt}{" "}
            <span className="text-xs text-muted-foreground">({TYPE_LABEL[q.type]})</span>
          </p>
          <ul className="ml-4 list-disc text-sm">
            {q.options.map((o) => (
              <li key={o.id} className={o.isCorrect ? "text-success" : "text-foreground/70"}>
                {o.isCorrect ? "✓ " : "• "}
                {o.text}
                {q.type === "matching" && o.right ? ` → ${o.right}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Card>
  );
}
