/**
 * A token-driven HORIZONTAL labeled-bar chart — NO chart library (P6 LAWS). Built
 * for "top N" rollups whose labels are long prose (top AI questions, most-missed
 * questions): each row is a label + a proportional bar + the raw count, so a long
 * question text wraps in normal flow rather than being clipped under an axis.
 *
 * The bars are plain token-filled divs (a horizontal bar needs no SVG path math),
 * sized by inline width-percent against the max value, in a brand chart token
 * (`--color-chart-{slot}`). Accessible: the list is a real <ol> with each bar
 * carrying `role="img"` + an `aria-label` of its label+value, and a
 * visually-hidden total so the proportions are interpretable.
 */
import { cn } from "@greenroom/ui/lib/utils";

export interface TopNDatum {
  label: string;
  value: number;
  /** Optional secondary note rendered under the label (e.g. "no grounding match"). */
  note?: string;
  /** Optional 1–5 token slot; omitted → all bars use slot 1 (sprout). */
  slot?: 1 | 2 | 3 | 4 | 5;
}

interface TopNBarsProps {
  data: TopNDatum[];
  /** Accessible summary, e.g. "Top questions asked of the AI assistant". */
  ariaLabel: string;
  /** Optional unit for the count suffix, e.g. "asks" / "wrong". */
  unit?: string;
  /** Empty-state copy when `data` is empty. */
  emptyLabel?: string;
  className?: string;
}

export function TopNBars({
  data,
  ariaLabel,
  unit,
  emptyLabel = "Nothing to show yet.",
  className,
}: TopNBarsProps) {
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ol className={cn("space-y-3", className)} aria-label={ariaLabel}>
      {data.map((d, i) => {
        const pct = Math.round((d.value / max) * 100);
        const slot = d.slot ?? 1;
        return (
          <li key={`${d.label}-${i}`} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-foreground">{d.label}</span>
              <span className="shrink-0 font-display text-sm font-bold tabular-nums text-muted-foreground">
                {d.value}
                {unit ? ` ${unit}` : ""}
              </span>
            </div>
            {d.note && <p className="text-xs text-muted-foreground">{d.note}</p>}
            <div
              className="h-2 w-full overflow-hidden rounded-sm bg-muted"
              role="img"
              aria-label={`${d.label}: ${d.value}${unit ? ` ${unit}` : ""}`}
            >
              <div
                className="h-full rounded-sm"
                style={{ width: `${pct}%`, backgroundColor: `var(--color-chart-${slot})` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
