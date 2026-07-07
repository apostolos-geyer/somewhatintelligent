import { useEffect, useState } from "react";
import { CalendarClock, Loader2, Radio, Users, Video } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import {
  listGroupSessions,
  registerSession,
  type GroupSessionView,
} from "@/lib/sessions.functions";
import { CallRoom } from "./CallRoom";

/** Capacity badge state: full when registered headcount meets a non-null cap. */
function isFull(s: GroupSessionView): boolean {
  return s.capacity != null && s.registeredCount >= s.capacity;
}

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
 * The group-session surface (P4.C). Lists the brand's scheduled/live/ended group
 * sessions with the caller's own registration state. The action is a strict
 * ladder — there is NO "Start Call Now" anywhere:
 *
 *   Register  →  (once `now >= startsAt`) Join  →  CallRoom
 *
 * "Join" is a COMPUTED gate on the client (`now >= startsAt`) mirroring the
 * server's join gate (there is NO `join_at` column). Joining mounts `CallRoom`,
 * which calls `joinSession` to lazily mint the realtime room. Capacity-full
 * sessions disable Register. `nowTick` re-renders each minute so a session that
 * crosses its start time flips Register→Join without a manual refresh.
 */
export function GroupSessions() {
  const [sessions, setSessions] = useState<GroupSessionView[] | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<{ sessionId: string; title: string } | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  async function refresh() {
    try {
      setSessions(await listGroupSessions());
    } catch {
      setSessions([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Re-evaluate the computed Join gate each minute (cheap; no network).
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  async function onRegister(session: GroupSessionView) {
    setRegistering(session.id);
    setError(null);
    try {
      await registerSession({ data: { sessionId: session.id } });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't register.");
    } finally {
      setRegistering(null);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (sessions === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-24 w-full rounded-sm" />
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <Users className="size-9 text-muted-foreground" aria-hidden />
        <p className="font-medium">No group sessions scheduled</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          When the brand schedules a live group session, it will appear here to register.
        </p>
      </div>
    );
  }

  // ── Sessions ────────────────────────────────────────────────────────────────
  return (
    <>
      <div className="space-y-3">
        {error && (
          <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {sessions.map((session) => {
          const started = nowTick >= session.startsAt;
          const ended = session.status === "ended";
          const full = isFull(session);
          const busy = registering === session.id;
          return (
            <Card
              key={session.id}
              className={cn("flex flex-col gap-3 p-4", surfaceMaterials.brutal)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium" title={session.title}>
                      {session.title}
                    </p>
                    {session.status === "live" && (
                      <Badge variant="growth">
                        <Radio className="size-3" aria-hidden />
                        Live
                      </Badge>
                    )}
                    {ended && <Badge variant="outline">Ended</Badge>}
                  </div>
                  {session.description && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {session.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="size-3.5" aria-hidden />
                      {formatWhen(session.startsAt)}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" aria-hidden />
                      {session.registeredCount}
                      {session.capacity != null ? ` / ${session.capacity}` : ""} registered
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-auto flex items-center justify-end gap-2">
                {ended ? (
                  <Button type="button" variant="outline" size="sm" disabled>
                    Session ended
                  </Button>
                ) : session.registered ? (
                  started ? (
                    <Button
                      type="button"
                      variant="strong"
                      size="sm"
                      onClick={() => setActive({ sessionId: session.id, title: session.title })}
                    >
                      <Video className="size-4" aria-hidden />
                      Join
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled>
                      Registered · starts {formatWhen(session.startsAt)}
                    </Button>
                  )
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    disabled={busy || full}
                    onClick={() => void onRegister(session)}
                  >
                    {busy ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : (
                      <Users className="size-4" aria-hidden />
                    )}
                    {full ? "Full" : "Register"}
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {active && (
        <CallRoom
          sessionId={active.sessionId}
          title={active.title}
          onClose={() => {
            setActive(null);
            void refresh();
          }}
        />
      )}
    </>
  );
}
