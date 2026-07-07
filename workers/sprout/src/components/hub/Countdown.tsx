import { useEffect, useState } from "react";
import { cn } from "@greenroom/ui/lib/utils";

interface CountdownProps {
  /** Epoch-ms the window closes; the countdown targets this instant. */
  target: number;
  className?: string;
}

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  done: boolean;
}

/** Break the ms until `target` into d/h/m/s, clamped at zero once it elapses. */
function remainingFrom(target: number, nowMs: number): Remaining {
  const ms = Math.max(0, target - nowMs);
  const totalSeconds = Math.floor(ms / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor((totalSeconds % 86_400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: ms === 0,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const DASH = "––";

/**
 * The Education-Award window's LIVE countdown — the period's remaining d/h/m/s,
 * ticking once a second toward `target`. `role="timer"` marks it as a live timing
 * region; `aria-live="off"` keeps a screen reader from announcing every tick (a
 * per-second barrage), per the field guidance. Clamps to "Closed" at zero.
 *
 * HYDRATION: `now` starts `null` — NOT `Date.now()` — so the SSR HTML and the
 * client's first hydration render are byte-identical (a dash skeleton). A live
 * `Date.now()` in the initial render would differ between the server instant and
 * the hydration instant, and because the Hub has no Suspense boundary React would
 * recover from that text mismatch by re-rendering the WHOLE root — remounting and
 * wiping sibling form state (this is what broke the CanSell submit). The real
 * clock is adopted in `useEffect` (post-mount, client-only), then ticked every
 * second; the interval is torn down on unmount.
 */
export function Countdown({ target, className }: CountdownProps) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const r = now === null ? null : remainingFrom(target, now);

  if (r?.done) {
    return (
      <span role="timer" aria-live="off" className={cn("font-display font-bold", className)}>
        Closed
      </span>
    );
  }

  // Until mounted (`r === null`) render the dash skeleton; the days cell shows
  // while we don't yet know the remaining (and whenever there's ≥1 day left).
  return (
    <span
      role="timer"
      aria-live="off"
      className={cn("inline-flex items-center gap-2 tabular-nums", className)}
    >
      {(r === null || r.days > 0) && <Unit value={r ? String(r.days) : DASH} label="d" />}
      <Unit value={r ? pad(r.hours) : DASH} label="h" />
      <Unit value={r ? pad(r.minutes) : DASH} label="m" />
      <Unit value={r ? pad(r.seconds) : DASH} label="s" />
    </span>
  );
}

/** One d/h/m/s cell: a bold numeric over a muted unit label. */
function Unit({ value, label }: { value: string; label: string }) {
  return (
    <span className="inline-flex items-baseline gap-0.5">
      <span className="font-display text-2xl font-bold leading-none">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}
