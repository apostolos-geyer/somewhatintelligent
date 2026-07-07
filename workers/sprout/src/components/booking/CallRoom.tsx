import { lazy, Suspense, useEffect, useState } from "react";
import { ClientOnly } from "@tanstack/react-router";
import { Loader2, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { joinSession, leaveSession, type RoomHandle } from "@/lib/sessions.functions";

// The RealtimeKit UI Kit (web components + WebRTC) is browser-only and sizeable —
// lazy() splits it off the portal's initial bundle so it loads on first Join only,
// and <ClientOnly> keeps it off SSR / the first hydration render entirely.
const RealtimeMeeting = lazy(() =>
  import("@/components/booking/RealtimeMeeting").then((m) => ({ default: m.RealtimeMeeting })),
);

interface CallRoomProps {
  sessionId: string;
  title: string;
  onClose: () => void;
}

/**
 * The in-platform call room (P4.C). Mounted ONLY after a Join action that the
 * caller already gated on `now >= startsAt` — there is NO "Start Call Now" button
 * anywhere; a room is always entered from a scheduled session. On mount it calls
 * `joinSession`, which lazily mints the realtime room + a participant token via
 * `lib/realtime`. When RealtimeKit is inert (local dev) the token is null and the
 * room degrades to a clear "video room — provision RealtimeKit" placeholder rather
 * than crashing. Leaving stamps `left_at` (engagement duration) via `leaveSession`.
 *
 * The actual RealtimeKit web client mount lands with the provisioned secrets; this
 * shell owns the lifecycle (join → token → leave) and the graceful placeholder so
 * the booking flow is exercisable end-to-end locally.
 */
export function CallRoom({ sessionId, title, onClose }: CallRoomProps) {
  const [state, setState] = useState<
    | { phase: "joining" }
    | { phase: "ready"; room: RoomHandle }
    | { phase: "error"; message: string }
  >({ phase: "joining" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "joining" });
    void (async () => {
      try {
        const room = await joinSession({ data: { sessionId } });
        if (!cancelled) setState({ phase: "ready", room });
      } catch (e) {
        if (!cancelled) {
          setState({
            phase: "error",
            message: e instanceof Error ? e.message : "Could not join the room.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  async function onLeave() {
    // Best-effort: stamp left_at, then close regardless of the result.
    try {
      await leaveSession({ data: { sessionId } });
    } catch {
      // never block the close on the leave write
    }
    onClose();
  }

  const roomSpinner = (
    <div className="flex flex-col items-center gap-3 text-muted-foreground">
      <Loader2 className="size-8 animate-spin" aria-hidden />
      <p className="text-sm">Loading the room…</p>
    </div>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Call room — ${title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Video className="size-5 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate font-display text-lg font-bold">{title}</h2>
        </div>
        <Button variant="destructive" size="sm" className="shrink-0" onClick={() => void onLeave()}>
          <PhoneOff className="size-4" aria-hidden />
          Leave
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6">
        {state.phase === "joining" && (
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <Loader2 className="size-8 animate-spin" aria-hidden />
            <p className="text-sm">Joining the room…</p>
          </div>
        )}

        {state.phase === "error" && (
          <div className="flex max-w-sm flex-col items-center gap-3 text-center">
            <VideoOff className="size-10 text-muted-foreground" aria-hidden />
            <p className="font-medium">Couldn't join</p>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        )}

        {state.phase === "ready" &&
          state.room.available &&
          state.room.token && (
            // Provisioned: mount the real RealtimeKit client against the join token.
            <ClientOnly fallback={roomSpinner}>
              <Suspense fallback={roomSpinner}>
                <RealtimeMeeting authToken={state.room.token} />
              </Suspense>
            </ClientOnly>
          )}

        {state.phase === "ready" && !state.room.available && (
          <div className="flex max-w-md flex-col items-center gap-4 py-12 text-center">
            <VideoOff className="size-10 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium">Video room — provision RealtimeKit</p>
              <p className="text-sm text-muted-foreground">
                The realtime service isn't reachable in this environment. Provision RealtimeKit
                (RTK_APP_ID / RTK_API_TOKEN) to host the live call here. Your attendance was still
                recorded.
              </p>
            </div>
            <Button variant="outline" onClick={() => void onLeave()}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
