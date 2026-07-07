import { lazy, Suspense, useState } from "react";
import { Sparkles } from "lucide-react";
import { usePortalContext } from "@/components/shell/portal-context";

// The assistant pulls in the Vercel AI SDK (`@ai-sdk/react` + `ai`) — a sizeable
// chunk that's dead weight on every portal page until the bubble is opened.
// Code-splitting it keeps it off the portal's initial bundle; it loads on first
// open only (the bubble stays interactive while the chunk streams in).
const AssistantChat = lazy(() =>
  import("@/components/ai/AssistantChat").then((m) => ({ default: m.AssistantChat })),
);

/**
 * Persistent bottom-right AI assistant bubble. Mounted once in the `_portal`
 * shell so it survives section-layer open/close. P4.D makes it FUNCTIONAL: the
 * bubble toggles the `AssistantChat` panel — a RAG assistant grounded in the
 * brand's own content, streamed via the Vercel AI SDK, that escalates to a BOOKED
 * call (never an instant call).
 *
 * The brand comes from the portal route context (the same `activeOrgId` the
 * server fn scopes to). While the panel is open the bubble hides — the panel owns
 * the bottom-right corner.
 */
export function AiBubble() {
  const { brand } = usePortalContext();
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <Suspense fallback={null}>
        <AssistantChat brand={brand} onClose={() => setOpen(false)} />
      </Suspense>
    );
  }

  return (
    <button
      type="button"
      aria-label="Ask the assistant"
      onClick={() => setOpen(true)}
      className="fixed right-4 bottom-4 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft-lg transition-transform hover:-translate-y-0.5 active:translate-y-0"
    >
      <Sparkles className="size-5" aria-hidden />
    </button>
  );
}
