import type { LogoColorScheme } from "./types";

/**
 * ── Consumer-edited brand surface ──
 *
 * This is the ONE file a downstream consumer edits to reskin the logo:
 * wordmark strings, the accessible name, and the mark's geometry/colors.
 * Every other file under `./logo/*` reads only from here — no brand text,
 * shape, or hex belongs anywhere else in this directory.
 *
 * `ogColors` MUST stay literal hex (not a CSS custom property): satori
 * (used for OG image generation) cannot resolve `var(--color-*)`.
 */
export interface LogoBrand {
  /** Full wordmark — `horizontal` and `compact` layouts. */
  wordmarkFull: string;
  /** Short wordmark (initials/abbreviation) — the `stacked` layout. */
  wordmarkShort: string;
  /** Accessible name for the icon mark (`aria-label`). */
  ariaLabel: string;
  /** Literal hex stroke colors the mark renders with on light vs. dark
   *  surfaces. Every `LogoColorScheme` combination derives from these two. */
  ogColors: {
    /** Stroke color for dark/filled surfaces. */
    primary: string;
    /** Stroke color for light surfaces. */
    light: string;
  };
}

export const brand: LogoBrand = {
  wordmarkFull: "somewhatintelligent",
  wordmarkShort: "SI",
  ariaLabel: "somewhatintelligent",
  ogColors: {
    primary: "#F8F7F1",
    light: "#171613",
  },
};

/** Mark stroke color per `LogoColorScheme`, derived from `brand.ogColors`. */
export const MARK_STROKE: Record<LogoColorScheme, string> = {
  primary: brand.ogColors.primary,
  light: brand.ogColors.light,
  "mono-light": brand.ogColors.primary,
  "mono-dark": brand.ogColors.light,
  "on-destructive": brand.ogColors.primary,
  "on-success": brand.ogColors.primary,
};

/**
 * The mark's geometry — a simple neutral registration symbol (a circle with
 * four cardinal tick marks and a plotted center point), expressed as raw
 * path/circle data rather than a component so it stays hook-free and
 * renders identically in the browser and in satori/OG image generation.
 * Swap these for a custom mark's own geometry.
 */
export const markPaths = {
  circleRadius: 6.5,
  ticks: ["M12 2.5v4", "M12 17.5v4", "M2.5 12h4", "M17.5 12h4"],
  centerRadius: 0.9,
};
