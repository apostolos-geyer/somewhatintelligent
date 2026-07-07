import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type } from "arktype";
import { MessageSquarePlus, Sparkles } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@greenroom/ui/components/tabs";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { AdminPageHeader, ErrorBanner } from "@/components/admin/AdminScaffold";
import { RowEditButton } from "@/components/admin/ListRow";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import {
  addCustomQA,
  listCustomQa,
  listQaLog,
  setCustomQaEnabled,
  type CustomQaView,
  type QaLogView,
} from "@/lib/ai.functions";

/**
 * Brand-Admin AI management (P4.D). Nests under the pathless `admin.tsx` guard —
 * SELF-CONTAINED (imports no Admin setup chrome). Two tabs:
 *
 *  - Custom Q&A: author/edit the grounding rows the assistant answers from (a
 *    saved row is re-indexed into Vectorize off the queue). Toggle on/off without
 *    deleting. All mutations are brand-role gated server-side (`decideBrandAdmin`).
 *  - Question log: the append-only record of what budtenders asked + how the
 *    assistant answered (and whether it had to escalate to a booked call).
 *
 * brand_id is the envelope's activeOrgId, never sent.
 */
export const Route = createFileRoute("/admin/ai")({
  component: AdminAiPage,
});

function AdminAiPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="AI assistant"
        description="The in-portal assistant answers budtenders from this brand's own content. Add custom Q&A to fill gaps, and review what's being asked."
      />

      <Tabs defaultValue="custom-qa">
        <TabsList className="mb-2 flex-wrap">
          <TabsTrigger value="custom-qa">
            <Sparkles className="size-4" aria-hidden />
            Custom Q&amp;A
          </TabsTrigger>
          <TabsTrigger value="log">
            <MessageSquarePlus className="size-4" aria-hidden />
            Question log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="custom-qa">
          <CustomQaTab />
        </TabsContent>
        <TabsContent value="log">
          <QaLogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── custom Q&A tab ─────────────────────────────────────────────────────────

function CustomQaTab() {
  const [rows, setRows] = useState<CustomQaView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomQaView | "new" | null>(null);

  async function refresh() {
    try {
      setRows(await listCustomQa());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load custom Q&A.");
      setRows([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          These answers are grounded into the assistant alongside your products and decks.
        </p>
        <Button type="button" variant="default" size="sm" onClick={() => setEditing("new")}>
          <MessageSquarePlus className="size-4" aria-hidden />
          Add Q&amp;A
        </Button>
      </div>

      <ErrorBanner error={error} />

      {rows === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-sm" />
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No custom Q&A yet. Add one to teach the assistant something it can't infer from your
          content.
        </p>
      )}

      <ul className="space-y-2">
        {rows?.map((row) => (
          <li
            key={row.id}
            className={cn(
              "flex flex-wrap items-start gap-3 p-3 sm:flex-nowrap",
              surfaceMaterials.brutal,
              !row.enabled && "opacity-60",
            )}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate font-medium" title={row.question}>
                {row.question}
              </p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{row.answer}</p>
            </div>
            {!row.enabled && <Badge variant="outline">Off</Badge>}
            <div className="flex shrink-0 items-center gap-1">
              <RowEditButton
                ariaLabel={`Edit Q&A: ${row.question}`}
                onClick={() => setEditing(row)}
              />
              <ToggleButton row={row} onToggled={() => void refresh()} />
            </div>
          </li>
        ))}
      </ul>

      {editing && (
        <CustomQaDialog
          row={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

function ToggleButton({ row, onToggled }: { row: CustomQaView; onToggled: () => void }) {
  const [busy, setBusy] = useState(false);
  async function onToggle() {
    setBusy(true);
    try {
      await setCustomQaEnabled({ data: { qaId: row.id, enabled: !row.enabled } });
      onToggled();
    } catch {
      setBusy(false);
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={busy}
      onClick={() => void onToggle()}
      aria-label={row.enabled ? `Disable ${row.question}` : `Enable ${row.question}`}
    >
      {row.enabled ? "Disable" : "Enable"}
    </Button>
  );
}

const qaSchema = type({
  question: "string >= 1",
  answer: "string >= 1",
});

function CustomQaDialog({
  row,
  onClose,
  onSaved,
}: {
  row: CustomQaView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      question: row?.question ?? "",
      answer: row?.answer ?? "",
    },
    validators: { onBlur: qaSchema },
    onSubmit: ({ value }) =>
      save(() =>
        addCustomQA({
          data: {
            ...(row ? { qaId: row.id } : {}),
            question: value.question.trim(),
            answer: value.answer.trim(),
          },
        }),
      ),
  });

  return (
    <FormDialog
      form={form}
      title={row ? "Edit Q&A" : "Add Q&A"}
      description="The assistant answers from these alongside your products and decks. Saving re-indexes it for search."
      onClose={onClose}
      error={saveError}
    >
      <form.AppField name="question">
        {(field) => (
          <field.TextField
            label="Question"
            placeholder="What's the difference between your live rosin and live resin?"
          />
        )}
      </form.AppField>

      <form.AppField name="answer">
        {(field) => (
          <field.TextareaField label="Answer" rows={5} placeholder="Live rosin is solventless…" />
        )}
      </form.AppField>
    </FormDialog>
  );
}

// ─── question-log tab ───────────────────────────────────────────────────────

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const SOURCE_LABEL: Record<string, string> = {
  product: "Product",
  deck: "Deck",
  asset: "Asset",
  custom_qa: "Custom Q&A",
  navigation: "Navigation",
  none: "No match",
};

function QaLogTab() {
  const [rows, setRows] = useState<QaLogView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await listQaLog({ data: {} }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load the question log.");
        setRows([]);
      }
    })();
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Every assistant turn, newest first. "No match" rows are where the assistant escalated to a
        booked call — good candidates for a new custom Q&A above.
      </p>

      <ErrorBanner error={error} />

      {rows === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-sm" />
          ))}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No questions logged yet.</p>
      )}

      <ul className="space-y-2">
        {rows?.map((row) => (
          <li key={row.id} className={cn("space-y-2 p-3", surfaceMaterials.brutal)}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium">{row.question}</p>
              <Badge variant={row.source === "none" ? "warn" : "soft"} className="shrink-0">
                {SOURCE_LABEL[row.source ?? "none"] ?? "No match"}
              </Badge>
            </div>
            <p className="line-clamp-3 text-sm text-muted-foreground">{row.answer}</p>
            <p className="text-xs text-muted-foreground">
              <time dateTime={new Date(row.createdAt).toISOString()}>
                {formatWhen(row.createdAt)}
              </time>
              {row.kind === "navigation" && " · navigation"}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
