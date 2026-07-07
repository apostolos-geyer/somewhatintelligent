import { useEffect, useMemo, useState } from "react";
import { CalendarClock, CalendarX2, Check, Loader2 } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { bookCall, listSlots, type BookableSlot } from "@/lib/sessions.functions";

interface SlotPickerProps {
  /** Fired after a successful booking — the AI bubble (P4.D) embeds the picker for
   *  booking escalation and refreshes its own state on this. */
  onBooked?: () => void;
}

/** Group slots by local calendar day for a clean day-then-time layout. */
function groupByDay(
  slots: BookableSlot[],
): Array<{ day: string; label: string; items: BookableSlot[] }> {
  const byDay = new Map<string, BookableSlot[]>();
  for (const s of slots) {
    const d = new Date(s.startsAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const bucket = byDay.get(key);
    if (bucket) bucket.push(s);
    else byDay.set(key, [s]);
  }
  return [...byDay.entries()].map(([day, items]) => ({
    day,
    label: new Date(items[0]!.startsAt).toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    }),
    items,
  }));
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A stable per-slot key (a slot is uniquely the window + its start). */
function slotKey(s: BookableSlot): string {
  return `${s.windowId}:${s.startsAt}`;
}

/**
 * The 1:1 booking surface (P4.C). Lists the brand's bookable slots derived from
 * availability windows (`listSlots`); a booked slot VANISHES (the slot UNIQUE is
 * enforced server-side, so a re-fetch simply drops it). Picking a slot calls
 * `bookCall`; on success the picker refetches (the slot disappears) and fires
 * `onBooked`. A lost race surfaces as `slot_taken` — we just refetch so the now-
 * gone slot drops from the grid. There is NO instant call here — only booking.
 *
 * Exported with `{ onBooked? }` so the AI bubble can embed it inline for booking
 * escalation ("talk to a human →").
 */
export function SlotPicker({ onBooked }: SlotPickerProps) {
  const [slots, setSlots] = useState<BookableSlot[] | null>(null);
  const [booking, setBooking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const rows = await listSlots();
      setSlots(rows);
    } catch {
      setSlots([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const groups = useMemo(() => groupByDay(slots ?? []), [slots]);

  async function onPick(slot: BookableSlot) {
    setBooking(slotKey(slot));
    setError(null);
    try {
      await bookCall({
        data: { windowId: slot.windowId, slotStartsAt: slot.startsAt },
      });
      await refresh(); // the booked slot vanishes
      onBooked?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't book that slot.";
      // A lost race ⇒ the slot is gone; refetch so the grid reconciles.
      if (msg === "slot_taken") await refresh();
      else setError(msg);
    } finally {
      setBooking(null);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (slots === null) {
    return (
      <div className="space-y-4">
        {[0, 1].map((g) => (
          <div key={g} className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <div className="flex flex-wrap gap-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-24 rounded-sm" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (slots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="size-9 text-muted-foreground" aria-hidden />
        <p className="font-medium">No open slots right now</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          When the brand opens 1:1 availability, bookable times will appear here.
        </p>
      </div>
    );
  }

  // ── Slots ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {groups.map((group) => (
        <Card key={group.day} className={cn("space-y-3 p-4", surfaceMaterials.brutal)}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-primary" aria-hidden />
            {group.label}
          </div>
          <div className="flex flex-wrap gap-2">
            {group.items.map((slot) => {
              const key = slotKey(slot);
              const busy = booking === key;
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || booking !== null}
                  onClick={() => void onPick(slot)}
                  aria-label={`Book ${formatTime(slot.startsAt)}`}
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Check
                      className="size-4 opacity-0 group-hover/button:opacity-100"
                      aria-hidden
                    />
                  )}
                  {formatTime(slot.startsAt)}
                </Button>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
