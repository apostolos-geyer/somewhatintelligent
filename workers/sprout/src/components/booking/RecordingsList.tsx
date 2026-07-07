import { useEffect, useState } from "react";
import { CalendarClock, Film, Loader2, Play, Video } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { VideoPlayer } from "@greenroom/ui/components/video-player";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { getRecordingUrl, listRecordings, type RecordingView } from "@/lib/recordings.functions";

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * The "Past sessions" surface (P7.A). Lists the brand's ended group sessions that
 * have a durable recording archived into roadie R2 (`listRecordings`) and plays
 * them back IN-PLATFORM via the shared `<VideoPlayer>`. Self-contained so the
 * booking / sessions surface can embed it directly.
 *
 * Playback is lazy: the signed URL is fetched per-recording via `getRecordingUrl`
 * only when the budtender opens one (no read URL is minted for rows they never
 * play). roadie blob I/O is inert in local dev (no R2), so a null URL degrades to
 * a "recording will be available once processed" note rather than a broken frame.
 */
export function RecordingsList() {
  const [recordings, setRecordings] = useState<RecordingView[] | null>(null);
  const [active, setActive] = useState<RecordingView | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listRecordings();
        if (!cancelled) setRecordings(rows);
      } catch {
        if (!cancelled) setRecordings([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (recordings === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-sm" />
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (recordings.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Film className="size-9 text-muted-foreground" aria-hidden />
        <p className="font-medium">No past recordings</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          When a group session ends, its recording is archived here for in-platform playback.
        </p>
      </div>
    );
  }

  // ── Recordings ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-3">
        {recordings.map((recording) => (
          <Card
            key={recording.sessionId}
            className={cn("flex flex-col gap-3 p-4", surfaceMaterials.brutal)}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium" title={recording.title}>
                    {recording.title}
                  </p>
                  <Badge variant="outline">
                    <Video className="size-3" aria-hidden />
                    Recording
                  </Badge>
                </div>
                {recording.description && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">
                    {recording.description}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <CalendarClock className="size-3.5" aria-hidden />
                    {formatWhen(recording.startsAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-auto flex items-center justify-end">
              <Button type="button" variant="strong" size="sm" onClick={() => setActive(recording)}>
                <Play className="size-4" aria-hidden />
                Watch
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {active && <RecordingPlayer recording={active} onClose={() => setActive(null)} />}
    </>
  );
}

/**
 * The full-screen in-platform player for a single past recording. On mount it
 * fetches the inline roadie read URL via `getRecordingUrl`; when roadie is inert
 * (local dev, no R2) the URL is null and the player degrades to a clear
 * "recording will be available once processed" note rather than a broken frame.
 */
function RecordingPlayer({
  recording,
  onClose,
}: {
  recording: RecordingView;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { phase: "loading" } | { phase: "ready"; url: string } | { phase: "unavailable" }
  >({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: "loading" });
    void (async () => {
      try {
        const res = await getRecordingUrl({ data: { sessionId: recording.sessionId } });
        if (cancelled) return;
        setState(res.url ? { phase: "ready", url: res.url } : { phase: "unavailable" });
      } catch {
        if (!cancelled) setState({ phase: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recording.sessionId]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Recording — ${recording.title}`}
      className="fixed inset-0 z-[60] flex flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2">
          <Film className="size-5 shrink-0 text-primary" aria-hidden />
          <h2 className="truncate font-display text-lg font-bold">{recording.title}</h2>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
        {state.phase === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
          </div>
        )}

        {state.phase === "unavailable" && (
          <div className="flex h-full items-center justify-center">
            <div className="flex max-w-md flex-col items-center gap-4 py-12 text-center">
              <Video className="size-10 text-muted-foreground" aria-hidden />
              <div className="space-y-1">
                <p className="font-medium">Recording will be available once processed</p>
                <p className="text-sm text-muted-foreground">
                  The recording store isn't reachable in this environment. Once the session
                  recording is archived (R2 provisioned), it will play here.
                </p>
              </div>
            </div>
          </div>
        )}

        {state.phase === "ready" && (
          <div className="mx-auto max-w-4xl">
            <VideoPlayer src={state.url} fileName={recording.title} />
          </div>
        )}
      </div>
    </div>
  );
}
