import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type } from "arktype";
import { Inbox, ShieldCheck } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  listInbox,
  replyContact,
  type ThreadStatus,
  type ThreadView,
} from "@/lib/contact.functions";

/**
 * Brand-Admin contact inbox (P4.B). Nests under the pathless `admin.tsx` guard —
 * SELF-CONTAINED. Lists the brand's contact threads (filterable by status) and
 * lets an admin reply: a reply INSERTs a `contact_replies` row AND emits a
 * `contact_reply` notification to the thread's author — that notification IS how
 * the reply reaches the budtender (the product has NO email client; no new channel
 * is created). Mutations are brand-role gated server-side (`decideBrandAdmin`);
 * brand_id is the envelope's activeOrgId, never sent.
 */
export const Route = createFileRoute("/admin/inbox")({
  component: AdminInboxPage,
});

/** The status filter chips, including an "all" pseudo-state. */
const FILTERS: ReadonlyArray<{ value: ThreadStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "replied", label: "Replied" },
  { value: "closed", label: "Closed" },
];

const STATUS_BADGE: Record<
  ThreadStatus,
  { variant: "sprout" | "sprout-glass" | "info"; label: string }
> = {
  open: { variant: "sprout-glass", label: "Open" },
  replied: { variant: "sprout", label: "Replied" },
  closed: { variant: "info", label: "Closed" },
};

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AdminInboxPage() {
  const [filter, setFilter] = useState<ThreadStatus | "all">("all");
  const [threads, setThreads] = useState<ThreadView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(status: ThreadStatus | "all") {
    try {
      setThreads(await listInbox({ data: status === "all" ? {} : { status } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the inbox.");
      setThreads([]);
    }
  }

  useEffect(() => {
    setThreads(null);
    setError(null);
    void refresh(filter);
  }, [filter]);

  const openCount = useMemo(
    () => (threads ?? []).filter((t) => t.status === "open").length,
    [threads],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Messages budtenders send from the Get-in-Touch section. Your replies reach them as an
          in-portal notification — there's no email here.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            variant={filter === f.value ? "strong" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
          >
            {f.label}
            {f.value === "open" && openCount > 0 && filter !== "open" ? ` · ${openCount}` : ""}
          </Button>
        ))}
      </div>

      {error && (
        <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {threads === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 w-full rounded-sm" />
          ))}
        </div>
      )}

      {threads !== null && threads.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <Inbox className="size-8" aria-hidden />
          <p className="text-sm">No messages here.</p>
        </div>
      )}

      <ul className="space-y-4">
        {threads?.map((thread) => (
          <ThreadCard key={thread.id} thread={thread} onReplied={() => void refresh(filter)} />
        ))}
      </ul>
    </div>
  );
}

const replySchema = type({
  body: "string >= 1",
});

function ThreadCard({ thread, onReplied }: { thread: ThreadView; onReplied: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const status = STATUS_BADGE[thread.status];

  const form = useAppForm({
    defaultValues: { body: "" },
    validators: { onBlur: replySchema },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      try {
        await replyContact({ data: { threadId: thread.id, body: value.body.trim() } });
        formApi.setFieldValue("body", "");
        onReplied();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send the reply.");
      }
    },
  });

  return (
    <li className={cn("flex flex-col gap-4 p-4", surfaceMaterials.brutal)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{thread.topic}</p>
            {thread.areaOfStore && (
              <Badge variant="soft" size="sm">
                {thread.areaOfStore}
              </Badge>
            )}
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {thread.authorName}
            {thread.store ? ` · ${thread.store}` : ""} · {thread.email}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatWhen(thread.createdAt)}
        </span>
      </div>

      <p className="whitespace-pre-wrap text-sm text-foreground">{thread.message}</p>

      {thread.replies.length > 0 && (
        <ul className="space-y-2 border-t border-border pt-3">
          {thread.replies.map((reply) => (
            <li key={reply.id} className="rounded-sm border border-border bg-card/50 p-3">
              {reply.fromBrand && (
                <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <ShieldCheck className="size-3.5" aria-hidden />
                  Team
                </span>
              )}
              <p className="whitespace-pre-wrap text-sm text-foreground">{reply.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">{formatWhen(reply.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.AppField name="body">
          {(field) => (
            <field.TextareaField
              label="Reply"
              rows={3}
              placeholder="Type your reply — it reaches them as a notification."
            />
          )}
        </form.AppField>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end">
          <form.AppForm>
            <form.SubmitButton label="Send reply" loadingLabel="Sending…" />
          </form.AppForm>
        </div>
      </form>
    </li>
  );
}
