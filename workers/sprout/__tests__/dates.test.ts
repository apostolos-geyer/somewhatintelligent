/**
 * Unit tests for the PURE date formatters (`src/lib/dates.ts`) shared by the Hub +
 * Sprout-Admin. These MUST be UTC-deterministic — a locale/timezone-dependent
 * format mismatches on hydration and (on the Suspense-less Hub) re-renders the
 * whole root. The tests pin the exact strings and assert UTC (not local) so the
 * date helpers can't silently drift back to `toLocaleDateString`.
 *
 * Node-pure (no env / React / cloudflare:workers) — runs in `bun run test`.
 */
import { describe, expect, it } from "vitest";
import { formatPeriod, fmtUtcDate } from "@/lib/dates";

describe("formatPeriod — 'YYYY-MM' → 'Month YYYY'", () => {
  it("formats a well-formed period with the full month name", () => {
    expect(formatPeriod("2026-06")).toBe("June 2026");
    expect(formatPeriod("2026-01")).toBe("January 2026");
    expect(formatPeriod("2026-12")).toBe("December 2026");
  });

  it("returns the input unchanged when malformed (out of range / non-numeric / empty)", () => {
    expect(formatPeriod("2026-13")).toBe("2026-13");
    expect(formatPeriod("2026-00")).toBe("2026-00");
    expect(formatPeriod("2026-xx")).toBe("2026-xx");
    expect(formatPeriod("")).toBe("");
  });
});

describe("fmtUtcDate — epoch-ms → 'Mon D, YYYY' from UTC parts", () => {
  it("formats from UTC, not the local timezone", () => {
    // 2026-06-25T00:00:00Z — the UTC calendar day is the 25th regardless of TZ.
    const ms = Date.UTC(2026, 5, 25, 0, 0, 0);
    expect(fmtUtcDate(ms)).toBe("Jun 25, 2026");
  });

  it("uses the UTC day even just before a UTC midnight (no off-by-one)", () => {
    // 2026-06-30T23:59:59Z — the end-of-day instant the CanSell form stores.
    const ms = Date.UTC(2026, 5, 30, 23, 59, 59);
    expect(fmtUtcDate(ms)).toBe("Jun 30, 2026");
  });

  it("month abbreviation is correctly 0-indexed against getUTCMonth", () => {
    expect(fmtUtcDate(Date.UTC(2026, 0, 1))).toBe("Jan 1, 2026");
    expect(fmtUtcDate(Date.UTC(2026, 11, 31))).toBe("Dec 31, 2026");
  });
});
