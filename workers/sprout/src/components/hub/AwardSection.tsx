import { GraduationCap, Sparkles, Target } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Countdown } from "@/components/hub/Countdown";
import { formatPeriod } from "@/lib/dates";
import type { AwardView, LastMonthWinnerView } from "@/lib/award.functions";

/**
 * Hub components #3 + #4 — the Education Award of the Month (hero + live
 * countdown + semi-anonymous leader + the caller's gap to first) and the
 * prior-period "Last Month's Winner" strip. The award is an EDUCATION FUND the
 * brand tops up for the period's top budtender — the framing is strictly
 * education-fund language, NEVER prize / reward / cash (product law, INV-1). All
 * numbers come from `getAward` / `getLastMonthWinner` (materialized snapshots,
 * never a live scan).
 */
export function AwardSection({
  awards,
  winners,
}: {
  awards: AwardView[];
  winners: LastMonthWinnerView[];
}) {
  return (
    <section className="flex flex-col gap-section">
      <div className="flex flex-col gap-5">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
            <GraduationCap className="size-6 text-primary" aria-hidden />
            Education Award of the Month
          </h2>
          <p className="text-sm text-muted-foreground">
            Each period, your brand tops up an education fund for the leading budtender — covering
            courses, certifications, and the cost of learning more.
          </p>
        </header>

        {awards.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-md border border-border py-16 text-center">
            <GraduationCap className="size-8 text-muted-foreground" aria-hidden />
            <p className="text-sm text-muted-foreground">
              No fund window is open right now. Keep learning — the next one opens when the period
              turns.
            </p>
          </div>
        ) : (
          awards.map((award) => <AwardHero key={award.brandId} award={award} />)
        )}
      </div>

      <LastMonthWinners winners={winners} />
    </section>
  );
}

/**
 * The hero Card for one brand's fund window: the brand name, what the fund covers,
 * a live countdown to the close, the semi-anonymous leader, and the caller's gap.
 */
function AwardHero({ award }: { award: AwardView }) {
  const leads = award.leaderScore != null && award.gapToFirst === 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="size-5 text-primary" aria-hidden />
            {award.brandName}
          </CardTitle>
          <Badge variant="sprout-glass">Education Fund</Badge>
        </div>
        {award.coversText && (
          <CardDescription className="text-sm">{award.coversText}</CardDescription>
        )}
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Closes in
          </span>
          <Countdown target={award.closesAt} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            icon={<Sparkles className="size-4 text-primary" aria-hidden />}
            label="Leader"
            value={award.leaderScore != null ? `${award.leaderScore} pts` : "No scores yet"}
          />
          <Stat
            icon={<Target className="size-4 text-primary" aria-hidden />}
            label={leads ? "Your standing" : "Your gap to first"}
            value={
              award.leaderScore == null
                ? "—"
                : leads
                  ? "You're leading"
                  : `${award.gapToFirst} pts behind`
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

/** One labelled stat tile inside the hero Card. */
function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-sm border border-border p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-primary/10">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-display font-bold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

/** The "Last Month's Winner" strip — the prior closed period's recorded winners. */
function LastMonthWinners({ winners }: { winners: LastMonthWinnerView[] }) {
  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-bold tracking-tight">Last Month&rsquo;s Winner</h2>
      {winners.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No fund was awarded last period. This month&rsquo;s could be yours.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {winners.map((w) => (
            <li
              key={w.brandId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border p-3"
            >
              <div className="flex items-center gap-2.5">
                <GraduationCap className="size-5 text-primary" aria-hidden />
                <div>
                  <div className="font-medium">{w.brandName}</div>
                  <div className="text-xs text-muted-foreground">{formatPeriod(w.period)}</div>
                </div>
              </div>
              <span className="font-display font-bold">{w.winnerName ?? "Awarded"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
