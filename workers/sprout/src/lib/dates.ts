/**
 * PURE date formatters shared across the Hub + Sprout-Admin. UTC-based so the SSR
 * render and the client's first hydration render produce the SAME string — a
 * locale/timezone-dependent `toLocaleDateString` mismatches on hydration and (on
 * this Suspense-less Hub) forces React to re-render the whole root. No
 * `cloudflare:workers`/env/React import, so these are node-unit-testable.
 */

const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * A score "period" key `"YYYY-MM"` → `"June 2026"` (label only, no clock math).
 * Returns the input unchanged if it isn't a well-formed period.
 */
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  const month = Number(m);
  if (!y || !Number.isFinite(month) || month < 1 || month > 12) return period;
  return `${MONTHS_LONG[month - 1]} ${y}`;
}

/** epoch-ms → `"Jun 25, 2026"` from UTC parts (deterministic across server/client). */
export function fmtUtcDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
