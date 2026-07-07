import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { cn } from "@greenroom/ui/lib/utils";
import { getUnreadCounts, type UnreadCount } from "@/lib/hub.functions";

/**
 * The Hub's unread-notification bell (P5.C — poll v1). It calls the gated GET
 * `getUnreadCounts` (built by the hubshell stream; returns the caller's unread
 * count PER brand) and SUMs to a single total for the badge. The Hub is the ONE
 * Sprout-branded surface and renders at the apex, so the bell lives in its chrome;
 * the badge deep-links to `/hub/notifications` (the cross-brand feed).
 *
 * Refresh is a POLL (push is deferred to P7): on mount, on every `window` focus,
 * and on a 30s interval. The first paint is SEEDED from `sessionStorage` so a
 * returning navigation doesn't flash an empty bell before the first fetch
 * resolves. When a refresh raises the total above the previous value the bell
 * PULSES once (a brief ring animation) to draw the eye to the new arrival; the
 * pulse clears on the next paint so it can re-fire on the following increment.
 *
 * Every fetch is best-effort: a failed poll keeps the last good total rather than
 * zeroing the badge (the bell must never lie low because one request blipped).
 */

const POLL_MS = 30_000;
const SEED_KEY = "sprout.hub.unread";

/** SUM the per-brand unread counts to the single total the badge shows. */
function sumUnread(counts: UnreadCount[]): number {
  return counts.reduce((acc, c) => acc + (c.unreadCount > 0 ? c.unreadCount : 0), 0);
}

/** Read the seeded total from sessionStorage (SSR-safe; returns 0 off-window). */
function readSeed(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.sessionStorage.getItem(SEED_KEY);
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist the latest total so the next mount paints it without a flash. */
function writeSeed(total: number): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SEED_KEY, String(total));
  } catch {
    /* storage disabled — the bell still works, just without seeding */
  }
}

export function NotificationBell({ className }: { className?: string }) {
  // Seed from sessionStorage so a returning nav shows the last total immediately.
  // `null` until the first client read so SSR + hydration agree on an empty badge.
  const [total, setTotal] = useState<number | null>(null);
  const [pulse, setPulse] = useState(false);
  const prevTotal = useRef(0);

  // Hydrate the seed on the client only (SSR can't read sessionStorage).
  useEffect(() => {
    const seeded = readSeed();
    prevTotal.current = seeded;
    setTotal(seeded);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = sumUnread(await getUnreadCounts());
      setTotal(next);
      writeSeed(next);
      if (next > prevTotal.current) {
        // New arrival since the last good total — pulse once, then clear so the
        // animation can re-fire on the next increment.
        setPulse(true);
        window.setTimeout(() => setPulse(false), 1200);
      }
      prevTotal.current = next;
    } catch {
      /* best-effort: keep the last good total rather than zeroing the badge */
    }
  }, []);

  // Poll: once on mount, on every window focus, and on a 30s interval.
  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [refresh]);

  const count = total ?? 0;
  const hasUnread = count > 0;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";

  return (
    <Link
      to="/hub/notifications"
      aria-label={label}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
    >
      <Bell className={cn("size-5", pulse && "animate-pulse")} aria-hidden />
      {hasUnread && (
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground tabular-nums",
            "h-4",
            pulse && "ring-2 ring-primary/40",
          )}
          aria-hidden
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
