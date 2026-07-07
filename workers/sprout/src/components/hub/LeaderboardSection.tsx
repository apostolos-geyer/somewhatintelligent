import { Trophy } from "lucide-react";
import { LeaderboardTable } from "@/components/hub/LeaderboardTable";
import type { PlatformLeaderboardView } from "@/lib/award.functions";
import { formatPeriod } from "@/lib/dates";

/**
 * Hub component #2 — the PLATFORM-WIDE leaderboard "this month". Unlike a brand
 * portal's per-brand board, this ranks a budtender by the SUM of their scores
 * across EVERY brand they belong to for the current period (the cross-brand view
 * that only exists on the apex Hub). The read + ranking live in
 * `getPlatformLeaderboard` (scoped to the caller's own memberships, never input);
 * this block just hands the already-ranked entries + the caller's pinned rank to
 * the shared `<LeaderboardTable>`. The user's own rank always shows.
 */
export function LeaderboardSection({ board }: { board: PlatformLeaderboardView }) {
  return (
    <section className="flex flex-col gap-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Trophy className="size-6 text-primary" aria-hidden />
          Leaderboard
          <span className="font-body text-sm font-normal text-muted-foreground">
            · {formatPeriod(board.period)}
          </span>
        </h2>
        <p className="text-sm text-muted-foreground">
          Your standing across every brand you belong to, this month.
        </p>
      </header>

      <LeaderboardTable
        entries={board.entries}
        ownRank={board.ownRank}
        period={board.period}
        hideHeader
      />
    </section>
  );
}
