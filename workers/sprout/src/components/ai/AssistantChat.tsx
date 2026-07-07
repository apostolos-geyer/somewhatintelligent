import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import type { Message } from "ai";
import { CalendarClock, Film, MessageSquare, Send, Sparkles, Users, X } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Textarea } from "@greenroom/ui/components/textarea";
import { Spinner } from "@greenroom/ui/components/spinner";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { SlotPicker } from "@/components/booking/SlotPicker";
import { GroupSessions } from "@/components/booking/GroupSessions";
import { RecordingsList } from "@/components/booking/RecordingsList";
import { askAssistant } from "@/lib/ai.functions";
import type { BrandRuntime } from "@/lib/brand";

/**
 * The assistant chat surface (P4.D) — a RAG chat panel grounded in the brand's
 * OWN content, wired to the `askAssistant` gated server fn via the Vercel AI SDK
 * `useChat`. The server fn returns a STREAMED `Response` (data-stream protocol),
 * so answers render token-by-token.
 *
 * The bridge: `useChat`'s `fetch` override calls the `askAssistant` server fn and
 * returns its raw streamed `Response` (TSS passes a handler-returned `Response`
 * straight through). brand_id is the envelope's activeOrgId server-side — never
 * sent from here. We only forward the question text + a `kind` hint.
 *
 * ESCALATION is BOOKING-ONLY: when the model couldn't answer from the corpus it
 * stamps the turn's annotation `{ escalate: true }`; the panel then surfaces the
 * booked-call `SlotPicker` (a scheduled slot — there is NO instant-call button
 * anywhere in this product).
 *
 * BOOKING-UNDER-THE-ASSISTANT-UMBRELLA (journey 10): the same panel carries a
 * "Sessions" view (toggled in the header) that surfaces the brand's upcoming
 * group sessions (Register → reminder → Join-at-start → in-platform `CallRoom`,
 * via `GroupSessions`) and, below, the archived past-session `RecordingsList`.
 * There is NO "Start Call Now" anywhere: 1:1 is booked via the chat-view
 * `SlotPicker` escalation only; group Join enables at start time (a computed
 * gate). Both views stay MOUNTED (toggled by visibility, not unmount) so the
 * live `useChat` stream and the sessions fetch each survive a tab switch.
 */
interface AssistantChatProps {
  brand: BrandRuntime | null;
  onClose: () => void;
}

/** Which view the assistant panel is showing — chat (RAG) vs booking sessions. */
type AssistantView = "chat" | "sessions";

/** Server-side control token the model emits to request a booked-call escalation. */
const ESCALATE_MARKER = "BOOK_A_CALL";

/** Read the per-message escalate flag the server wrote as a data-stream annotation. */
function isEscalated(message: Message): boolean {
  if (message.role !== "assistant") return false;
  for (const ann of message.annotations ?? []) {
    if (ann && typeof ann === "object" && "escalate" in ann) {
      return (ann as { escalate?: unknown }).escalate === true;
    }
  }
  // Fallback: the marker may still be mid-stream before the annotation lands.
  return message.content.includes(ESCALATE_MARKER);
}

/** Strip the control marker so the bubble never shows the raw protocol token. */
function cleanContent(content: string): string {
  return content.split(ESCALATE_MARKER).join("").trim();
}

export function AssistantChat({ brand, onClose }: AssistantChatProps) {
  // The active view — chat (RAG) vs the booking "Sessions" surface. Both panes
  // stay MOUNTED (toggled by visibility below) so the live `useChat` stream and
  // the GroupSessions / RecordingsList fetches each survive a tab switch.
  const [view, setView] = useState<AssistantView>("chat");

  const { messages, append, status, error } = useChat({
    // The transport is the gated server fn; `api` is unused because we override
    // `fetch`. `streamProtocol: "data"` matches `createDataStreamResponse`.
    api: "askAssistant",
    streamProtocol: "data",
    // `useChat`'s `fetch` is typed as the global `fetch` (incl. its `preconnect`
    // static) — we only need the call signature, so the bridge below is cast to
    // it. The bridge forwards the latest user turn to the gated server fn and
    // returns its raw streamed Response (TSS x-tss-raw passthrough), which is
    // exactly what the SDK's data-stream parser consumes.
    fetch: (async (_input, init) => {
      const body = init?.body ? (JSON.parse(init.body as string) as { messages?: Message[] }) : {};
      const turns = body.messages ?? [];
      const last = [...turns].reverse().find((m) => m.role === "user");
      const question = last?.content?.trim() ?? "";
      return await askAssistant({
        data: { question, kind: "customer" },
        signal: init?.signal ?? undefined,
      });
    }) as typeof fetch,
  });

  const busy = status === "submitted" || status === "streaming";
  const escalate = useMemo(() => messages.some((m) => isEscalated(m)), [messages]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, escalate]);

  const [booked, setBooked] = useState(false);

  // The prompt composer is a `useAppForm` (single `prompt` field) bridged to
  // `useChat` via `append`: on submit we push the trimmed turn as a user message
  // (the bridge `fetch` reads it as the last user turn) and reset the draft.
  // useChat's own `input` state is unused — the form owns the draft. Empty/while-
  // busy submits are no-ops (mirrored in the Send button's disabled state).
  const promptForm = useAppForm({
    defaultValues: { prompt: "" },
    onSubmit: ({ value, formApi }) => {
      const text = value.prompt.trim();
      if (busy || text.length === 0) return;
      void append({ role: "user", content: text });
      formApi.reset();
    },
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Brand assistant"
      className="fixed right-4 bottom-4 z-50 flex h-[min(34rem,calc(100dvh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-border bg-card shadow-soft-lg"
    >
      <header className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">Ask {brand?.name ?? "the brand"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {view === "chat"
                ? "Grounded in this brand's own content"
                : "Live group sessions + past recordings"}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close assistant"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* Segmented chat ↔ sessions toggle — booking stays under the assistant
            umbrella (journey 10). A real tablist so arrow keys / SR work. */}
        <div
          role="tablist"
          aria-label="Assistant views"
          className={cn("grid grid-cols-2 gap-1 rounded-sm p-1", surfaceMaterials.neo)}
        >
          <button
            type="button"
            role="tab"
            id="assistant-tab-chat"
            aria-selected={view === "chat"}
            aria-controls="assistant-panel-chat"
            onClick={() => setView("chat")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
              view === "chat"
                ? "bg-card text-foreground shadow-soft-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <MessageSquare className="size-3.5" aria-hidden />
            Ask
          </button>
          <button
            type="button"
            role="tab"
            id="assistant-tab-sessions"
            aria-selected={view === "sessions"}
            aria-controls="assistant-panel-sessions"
            onClick={() => setView("sessions")}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
              view === "sessions"
                ? "bg-card text-foreground shadow-soft-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Users className="size-3.5" aria-hidden />
            Sessions
          </button>
        </div>
      </header>

      {/* ── Sessions view — group sessions (Register → Join-at-start → CallRoom)
          above the archived past-session recordings. Kept mounted (hidden, not
          unmounted) so its fetches survive a tab switch back to chat. ── */}
      <div
        role="tabpanel"
        id="assistant-panel-sessions"
        aria-labelledby="assistant-tab-sessions"
        hidden={view !== "sessions"}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto px-4 py-4",
          view === "sessions" ? "space-y-6" : "",
        )}
      >
        <section aria-label="Upcoming group sessions" className="space-y-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Group sessions</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Register for a live session — you'll get a reminder, and Join goes live at start time.
            There's no instant call; everything is scheduled.
          </p>
          <GroupSessions />
        </section>

        <section aria-label="Past session recordings" className="space-y-3">
          <div className="flex items-center gap-2">
            <Film className="size-4 text-primary" aria-hidden />
            <h3 className="text-sm font-semibold">Past sessions</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Recordings of sessions that have ended, archived for in-platform playback.
          </p>
          <RecordingsList />
        </section>
      </div>

      {/* ── Chat view — the RAG stream + booking escalation. ── */}
      <div
        ref={scrollRef}
        role="tabpanel"
        id="assistant-panel-chat"
        aria-labelledby="assistant-tab-chat"
        hidden={view !== "chat"}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Sparkles className="size-7 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">How can I help?</p>
            <p className="max-w-[16rem] text-xs text-muted-foreground">
              Ask about products, talking points, or where to find something in the portal. I only
              answer from {brand?.name ?? "this brand"}'s content.
            </p>
          </div>
        )}

        {messages.map((message) => {
          const text = cleanContent(message.content);
          if (message.role !== "user" && message.role !== "assistant") return null;
          if (text.length === 0 && message.role === "assistant" && !isEscalated(message))
            return null;
          return (
            <div
              key={message.id}
              className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-sm px-3 py-2 text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : cn("text-foreground", surfaceMaterials.brutal),
                )}
              >
                {text}
              </div>
            </div>
          );
        })}

        {status === "submitted" && (
          <div className="flex justify-start">
            <div className={cn("rounded-sm px-3 py-2", surfaceMaterials.brutal)}>
              <Spinner size="sm" className="text-muted-foreground" />
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            The assistant hit a snag. Try again, or book a call below.
          </p>
        )}

        {escalate && !booked && <EscalationCard brand={brand} onBooked={() => setBooked(true)} />}
        {booked && (
          <div
            className={cn(
              "flex items-center gap-2 rounded-sm px-3 py-2 text-sm",
              surfaceMaterials.brutal,
            )}
          >
            <CalendarClock className="size-4 text-primary" aria-hidden />
            <span>Your call is booked — you'll get a reminder before it starts.</span>
          </div>
        )}
      </div>

      {/* The prompt composer — a `useAppForm` single-field row wired by hand via
          `form.AppField`'s render prop (like Composer / ReviewComposer) so the
          inline Textarea + Send + Enter-to-send keeps its tight row layout. */}
      <form
        hidden={view !== "chat"}
        className="flex shrink-0 items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void promptForm.handleSubmit();
        }}
      >
        <promptForm.AppField name="prompt">
          {(field) => (
            <Textarea
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Ask a question…"
              rows={1}
              className="max-h-28 min-h-9 resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void promptForm.handleSubmit();
                }
              }}
            />
          )}
        </promptForm.AppField>
        <promptForm.Subscribe selector={(state) => state.values.prompt.trim().length > 0}>
          {(hasDraft) => (
            <Button type="submit" size="icon" disabled={busy || !hasDraft} aria-label="Send">
              {busy ? <Spinner size="xs" /> : <Send className="size-4" aria-hidden />}
            </Button>
          )}
        </promptForm.Subscribe>
      </form>
    </div>
  );
}

/**
 * The booked-call escalation surface — shown when the assistant couldn't answer
 * from the brand corpus. It mounts the sessions-stream `SlotPicker` (a SCHEDULED
 * slot; there is NO instant-call action). On a successful booking the panel flips
 * to a confirmation line.
 */
function EscalationCard({ brand, onBooked }: { brand: BrandRuntime | null; onBooked: () => void }) {
  return (
    <div className={cn("space-y-3 rounded-sm p-3", surfaceMaterials.brutal)}>
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p className="text-sm">
          I couldn't answer that from {brand?.name ?? "the brand"}'s content. Book a call with a
          brand specialist and they'll walk you through it.
        </p>
      </div>
      <SlotPicker onBooked={onBooked} />
    </div>
  );
}
