import { Medal, Trophy } from "lucide-react";
import { cn } from "@greenroom/ui/lib/utils";
import type { LeaderboardEntry } from "@/lib/hub.functions";
import { formatPeriod } from "@/lib/dates";

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  /** The caller's rank; when set, their row is pinned + highlighted. */
  ownRank: number | null;
  /** "YYYY-MM" — surfaced in the header so the board's window is unambiguous. */
  period: string;
  /** Suppress the built-in title header when the surrounding surface already
   *  provides one (e.g. the Hub home's LeaderboardSection). Defaults to false so
   *  the standalone usages (Quizzes leaderboard tab) keep their header. */
  hideHeader?: boolean;
}

/**
 * The reusable bordered top-N leaderboard table (identity admin-table shape: a
 * page-title header over a bordered container, header row, `border-b` rows). Used
 * by the Quizzes section's Leaderboard tab now and the Hub later, so it is purely
 * presentational — it takes already-ranked `entries`, the caller's `ownRank`, and
 * the `period`; the read + ranking live in `getLeaderboard`.
 *
 * When `ownRank` is set, the caller's row is highlighted in place if it's already
 * in the top N; if it falls outside the window, a pinned summary row is appended
 * so the budtender always sees where they stand. `displayName` is null this phase
 * (names resolve from guestlist later) — rows show a shortened user id until then.
 */
export function LeaderboardTable({
  entries,
  ownRank,
  period,
  hideHeader = false,
}: LeaderboardTableProps) {
  // Is the caller's row already inside the rendered top N? If so we highlight it
  // in place; otherwise we append a pinned summary row.
  const ownInTop = ownRank != null && entries.some((e) => e.rank === ownRank);

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
            <Trophy className="size-5 text-primary" aria-hidden />
            Leaderboard
          </h2>
          <p className="text-sm text-muted-foreground">{formatPeriod(period)}</p>
        </header>
      )}

      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border py-16 text-center">
          <Trophy className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No scores yet this period. Pass a quiz to get on the board.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[360px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="w-16 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Rank
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Budtender
                </th>
                <th className="w-24 px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <LeaderboardRow
                  key={entry.userId}
                  entry={entry}
                  highlighted={ownInTop && entry.rank === ownRank}
                />
              ))}
              {ownRank != null && !ownInTop && <OwnSummaryRow rank={ownRank} />}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeaderboardRow({ entry, highlighted }: { entry: LeaderboardEntry; highlighted: boolean }) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0",
        highlighted && "bg-primary/10 font-medium",
      )}
    >
      <td className="px-4 py-3 tabular-nums text-muted-foreground">
        <RankBadge rank={entry.rank} />
      </td>
      <td className="px-4 py-3">
        <span className={cn("font-medium", !entry.displayName && "text-muted-foreground")}>
          {entry.displayName ?? shortenId(entry.userId)}
        </span>
        {highlighted && <span className="ml-2 text-xs text-primary">You</span>}
      </td>
      <td className="px-4 py-3 text-right font-display font-bold tabular-nums">{entry.score}</td>
    </tr>
  );
}

/**
 * Pinned row for a caller who ranks below the rendered top N. The board only
 * carries the top N's scores, so the score cell shows a dash here — the caller's
 * own score lives on the `LeaderboardView`; this row only places their rank.
 */
function OwnSummaryRow({ rank }: { rank: number }) {
  return (
    <tr className="border-t-2 border-border bg-primary/10 font-medium">
      <td className="px-4 py-3 tabular-nums text-muted-foreground">
        <RankBadge rank={rank} />
      </td>
      <td className="px-4 py-3">
        <span className="font-medium">You</span>
      </td>
      <td className="px-4 py-3 text-right font-display font-bold tabular-nums">—</td>
    </tr>
  );
}

/** The top three get a medal glyph (gold/silver/bronze tone); the rest plain `#n`. */
function RankBadge({ rank }: { rank: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {rank <= 3 && (
        <Medal
          className={cn(
            "size-4",
            rank === 1 && "text-primary",
            rank === 2 && "text-muted-foreground",
            rank === 3 && "text-muted-foreground/70",
          )}
          aria-hidden
        />
      )}
      <span>#{rank}</span>
    </span>
  );
}

/** Until guestlist names resolve, show a short, stable handle from the user id. */
function shortenId(userId: string): string {
  return userId.length <= 8 ? userId : `${userId.slice(0, 8)}…`;
}
