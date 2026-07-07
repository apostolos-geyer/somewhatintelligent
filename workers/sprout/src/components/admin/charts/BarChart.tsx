/**
 * A token-driven SVG bar chart — NO chart library (recharts/visx/plot are
 * forbidden, per P6 LAWS). Pure presentational primitive: it takes already-shaped
 * `{ label, value }` data and draws vertical bars sized to the max value, filling
 * with the brand chart tokens (`--color-chart-1..5`, which Sprout maps to
 * sprout/stigma/growth/pistil/haze). Accessible: the <svg> is `role="img"` with a
 * composed `aria-label`, and an always-present visually-hidden <table> fallback so
 * screen-reader users and copy-paste both get the raw numbers.
 *
 * Layout is viewBox-relative (the SVG scales to its container) so the chart is
 * responsive without measuring the DOM. Bars are `rounded-sm` via a small rx.
 */
import { cn } from "@greenroom/ui/lib/utils";

export interface BarDatum {
  label: string;
  value: number;
  /**
   * Optional 1–5 token slot (`--color-chart-{slot}`). Omitted → bars cycle the
   * five chart tokens by index so a multi-series chart stays legible.
   */
  slot?: 1 | 2 | 3 | 4 | 5;
}

interface BarChartProps {
  data: BarDatum[];
  /** Accessible chart summary, e.g. "Deck opens by deck". */
  ariaLabel: string;
  /** Optional unit appended to the table fallback values, e.g. "opens". */
  unit?: string;
  className?: string;
  /** Render height in px (the viewBox height); width is fluid. Default 180. */
  height?: number;
}

const CHART_SLOTS = [1, 2, 3, 4, 5] as const;

/** The CSS var for a 1–5 chart slot (Sprout's sprout/stigma/growth/pistil/haze). */
function slotFill(slot: number): string {
  return `var(--color-chart-${slot})`;
}

export function BarChart({ data, ariaLabel, unit, className, height = 180 }: BarChartProps) {
  // viewBox units — fluid width, fixed aspect. 100 wide keeps the math simple.
  const VB_W = 100;
  const VB_H = 100;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length);
  // Even gaps: each slot is VB_W/n wide; the bar takes 64% of its slot.
  const slotW = VB_W / n;
  const barW = slotW * 0.64;
  const pad = (slotW - barW) / 2;

  return (
    <figure className={cn("w-full", className)}>
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
      >
        {/* Baseline */}
        <line
          x1={0}
          y1={VB_H}
          x2={VB_W}
          y2={VB_H}
          stroke="var(--color-border)"
          strokeWidth={0.5}
          vectorEffect="non-scaling-stroke"
        />
        {data.map((d, i) => {
          const h = (d.value / max) * (VB_H - 4); // 4u headroom so the tallest bar breathes
          const x = i * slotW + pad;
          const y = VB_H - h;
          const slot = d.slot ?? CHART_SLOTS[i % CHART_SLOTS.length]!;
          return (
            <rect
              key={`${d.label}-${i}`}
              x={x}
              y={y}
              width={barW}
              height={Math.max(0, h)}
              rx={1}
              fill={slotFill(slot)}
            >
              <title>{`${d.label}: ${d.value}${unit ? ` ${unit}` : ""}`}</title>
            </rect>
          );
        })}
      </svg>

      {/* Visually-hidden data table fallback (the accessible source of truth). */}
      <figcaption className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Label</th>
              <th scope="col">Value{unit ? ` (${unit})` : ""}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => (
              <tr key={`${d.label}-row-${i}`}>
                <td>{d.label}</td>
                <td>{d.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
