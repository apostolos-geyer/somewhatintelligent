/**
 * somewhatintelligent Color Tokens — "DRAFT" (blueprint monochrome)
 *
 * The UI is a technical drawing: warm drafting-paper surfaces, near-black
 * ink, and NO chromatic accents. Depth and state are communicated by ink
 * weight and border treatment (solid / dashed / dotted), never by color or
 * soft shadow. The single permitted functional color is `rust` — destructive
 * actions only — because "delete" must never be ambiguous.
 *
 * Two layers live here:
 *   1. SEMANTIC tokens (bg/surface/text/border + 5 accents) that product
 *      surfaces and codegen consume. This is the source of truth.
 *   2. RAW ink/paper ramps exported for illustration surfaces that need a
 *      literal step (e.g. OG images, charts) without re-deriving it.
 *
 * Accent slots (names are load-bearing — Tailwind utilities derive from them):
 *   ink     — primary interactive: buttons, links, focus, active states
 *   rust    — destructive / danger (the one functional color)
 *   success — positive / confirmation (dark ink-gray; pair with solid border)
 *   warning — attention / pending    (mid ink-gray; pair with dashed border)
 *   info    — informational          (light ink-gray; pair with dotted border)
 *
 * Light mode is the primary identity (ink on paper); dark mode is the
 * inverted drafting board (paper-ink lines on graphite). Both hand-authored.
 */

export interface HSLColor {
  hsl: string;
  h: number;
  s: number;
  l: number;
  hex: string;
}

function hsl(h: number, s: number, l: number): HSLColor {
  return { hsl: `${h} ${s}% ${l}%`, h, s, l, hex: hslToHex(h, s, l) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ============================================
// RAW RAMPS — exact hex, theme-invariant
//
// Ink = warm near-black graphite. Paper = warm drafting white.
// These are the only raw ramps; there is no chromatic brand palette.
// ============================================

/** Warm graphite ink ramp — text, lines, fills. */
export const inkRamp = {
  950: "#171613", // primary ink — the pen
  900: "#23221E",
  800: "#35342E",
  700: "#4A4841",
  600: "#5F5D54",
  500: "#757268",
  400: "#8E8B80",
  300: "#A8A599",
  200: "#C4C1B6",
} as const;

/** Warm drafting-paper ramp — surfaces. */
export const paperRamp = {
  0: "#FFFFFF",
  50: "#FCFBF7",
  100: "#F8F7F1", // the paper itself
  200: "#EFEDE4",
  300: "#E2E0D4",
} as const;

/**
 * Functional status — monochrome by design. Success/warning/info are ink
 * steps (state is carried by border treatment at the component layer);
 * danger is the single functional color, a desaturated drafting-red.
 */
export const statusColors = {
  success: "#2F5C41", // approval-stamp green
  successBg: "#E7EFE8",
  warning: "#5F5D54", // ink-600 — process state, carried by DASHED border
  warningBg: "#EFEDE4",
  warningInk: "#35342E",
  danger: "#96432B", // rust — red pen
  dangerBg: "#F3E6E0",
  dangerInk: "#6E2F1D",
  info: "#757268", // ink-500 — carried by DOTTED border
  infoBg: "#F3F1EA",
} as const;

// ============================================
// LIGHT MODE — primary identity
// Ink on warm drafting paper.
// ============================================

export const lightColors = {
  // ── Paper surfaces ──
  bg: hsl(45, 33, 96), // drafting paper (#F8F7F1)
  surface: hsl(0, 0, 100), // white sheet
  surfaceRaised: hsl(48, 45, 99), // fresh sheet on top
  surfaceSunken: hsl(45, 20, 92), // recessed well — inset rows, code

  // ── Ruled lines ── (drafting lines are PROMINENT — they are the design)
  border: hsl(45, 6, 52), // standard rule — 3.4:1 on paper
  borderStrong: hsl(45, 8, 30), // heavy rule — inputs, emphasis

  // ── Ink ──
  text: hsl(45, 8, 8), // primary ink (#171613-ish)
  textSecondary: hsl(45, 6, 29), // annotations
  textTertiary: hsl(45, 4, 42), // faint pencil — metadata, captions
  textOnAccent: hsl(45, 33, 96), // paper — text ON ink fills
} as const;

// ============================================
// DARK MODE — the inverted drafting board
// Paper-ink lines on warm graphite.
// ============================================

export const darkColors = {
  // ── Graphite surfaces ──
  bg: hsl(45, 7, 8), // board
  surface: hsl(45, 6, 11), // sheet
  surfaceRaised: hsl(45, 7, 14), // lifted sheet
  surfaceSunken: hsl(45, 9, 5), // carved well

  // ── Chalk lines ──
  border: hsl(45, 5, 40), // standard rule — ~3:1 on board
  borderStrong: hsl(45, 7, 58), // heavy rule

  // ── Chalk ink ──
  text: hsl(45, 22, 91), // paper-white ink
  textSecondary: hsl(45, 11, 71),
  textTertiary: hsl(45, 7, 55),
  textOnAccent: hsl(45, 7, 9), // graphite — text ON chalk fills
} as const;

// ============================================
// Accents — ink weights + the red pen
//
// Light-mode accents are DEEP (paper text reads on their fills); dark-mode
// accents are CHALK-BRIGHT (graphite text reads on them). Success/warning/
// info are deliberately monochrome — components MUST pair them with their
// border treatment (solid/dashed/dotted) so state never depends on hue.
// ============================================

export const accentColors = {
  /** Primary interactive — the pen itself. Links, CTAs, focus rings,
   *  active states. Solid ink fill with paper text. */
  ink: {
    light: hsl(45, 9, 12),
    lightHover: hsl(45, 10, 3),
    dark: hsl(45, 20, 88),
    darkHover: hsl(45, 24, 97),
  },
  /** The red pen. Destructive actions, critical alerts, errors.
   *  The ONLY functional color in the system. */
  rust: {
    light: hsl(14, 55, 38), // 5.0:1 with paper text
    lightHover: hsl(14, 60, 31),
    dark: hsl(14, 52, 63),
    darkHover: hsl(13, 58, 71),
  },
  /** Positive / confirmation — the approval stamp. A muted drafting green
   *  (functional color #2 by owner decree: outcomes may be colored; process
   *  states stay ink). Pair with SOLID border. */
  success: {
    light: hsl(140, 32, 27),
    lightHover: hsl(140, 36, 21),
    dark: hsl(140, 28, 66),
    darkHover: hsl(139, 32, 74),
  },
  /** Attention / pending. Mid ink — pair with DASHED border. */
  warning: {
    light: hsl(45, 6, 34),
    lightHover: hsl(45, 7, 27),
    dark: hsl(45, 10, 66),
    darkHover: hsl(45, 12, 74),
  },
  /** Informational. Light ink — pair with DOTTED border. */
  info: {
    light: hsl(45, 4, 40),
    lightHover: hsl(45, 5, 33),
    dark: hsl(45, 7, 58),
    darkHover: hsl(45, 8, 66),
  },
} as const;

// ============================================
// Effects — flat. No translucency, no blur.
// The "glass" slot survives for API compatibility but renders as an
// opaque sheet with a solid rule; blur is 0 (see shadows.ts + theme.css).
// ============================================

export const effectColors = {
  glass: {
    light: {
      bg: "hsl(48 45% 99%)", // opaque fresh sheet
      border: "hsl(45 6% 52%)", // standard rule
    },
    dark: {
      bg: "hsl(45 7% 14%)", // opaque lifted sheet
      border: "hsl(45 5% 40%)",
    },
    blur: "0px",
  },
} as const;

// ============================================
// Exports
// ============================================

/**
 * Deterministic light-from-dark inversion, kept for tooling/back-compat.
 */
function invertForLight(color: HSLColor): HSLColor {
  const l = Math.min(97, Math.max(3, 100 - color.l));
  const s = Math.round(color.s * 0.9);
  return hsl(color.h, s, l);
}

export { invertForLight };
