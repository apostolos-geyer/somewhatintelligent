/**
 * BRAND SURFACE — the one file a consumer edits to reskin this template.
 *
 * Everything below is a literal color value. Nothing elsewhere in this
 * package (src/tokens/colors.ts, scripts/codegen.ts, generated/css/*)
 * hardcodes a hex or HSL literal — they all resolve through the values
 * exported here. Retint a brand by editing the numbers in this file, then
 * run `bun run codegen && bun run audit:contrast` (see README.md).
 *
 * Two layers:
 *   1. RAMPS (`neutralRamp`, `accentRamp`) — theme-invariant hex steps for
 *      illustration surfaces (OG images, charts) that want an exact value
 *      without re-deriving one. Keep the same step keys (50..950) so
 *      codegen's iteration keeps working after a retint.
 *   2. THEME VALUES (`lightPalette`, `darkPalette`, `functionalColors`) —
 *      theme-aware HSL values, hand-tuned per mode so `bun run
 *      audit:contrast` can hit WCAG AA. Adjust H/S/L here, not in colors.ts.
 *
 * somewhatintelligent ("DRAFT" — blueprint monochrome): warm drafting-paper
 * surfaces, near-black ink, and no chromatic brand accent. `neutralRamp` is
 * the paper→ink continuum (steps 50-300 from the paper ramp, 400-950 from
 * the ink ramp); `accentRamp` carries the one functional color in the
 * system — rust, destructive actions only — as a full illustration ramp.
 * `functionalColors.primary` is ink itself (the pen), not a chromatic hue.
 * `warning` is deliberately tuned lighter than the old ("DRAFT") design's
 * mid-ink value: this template's fixed semantic contract
 * (src/tokens/colors.ts) always pairs `warningForeground` with dark text in
 * BOTH themes, so the fill itself must read as a light tone even in light
 * mode (unlike primary/destructive/success, which are dark solids in light
 * mode). See `bun run audit:contrast`.
 *
 * FONTS are a separate swap point — see the doc comments in
 * src/tokens/typography.ts (`fontStacks`) and src/fonts.css.
 */

export interface HSLColor {
  hsl: string;
  h: number;
  s: number;
  l: number;
  hex: string;
}

export function hsl(h: number, s: number, l: number): HSLColor {
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
// RAMPS — exact hex, theme-invariant.
// Namespaced so they never collide with the semantic vars codegen also
// emits (semantic `--color-primary` (theme-aware) vs raw `--color-accent-500`).
// Never reference these in product UI chrome — semantic tokens only.
// ============================================

/** Neutral grayscale — the paper→ink continuum. Steps 50-300 are the warm
 *  drafting-paper ramp; 400-950 are the warm graphite ink ramp. */
export const neutralRamp = {
  50: "#FCFBF7",
  100: "#F8F7F1",
  200: "#EFEDE4",
  300: "#E2E0D4",
  400: "#8E8B80",
  500: "#757268",
  600: "#5F5D54",
  700: "#4A4841",
  800: "#35342E",
  900: "#23221E",
  950: "#171613",
} as const;

/** Rust — the single functional color in the system (destructive actions
 *  only). Full illustration ramp graduated around the base rust hue (14°);
 *  step 700 is the exact `functionalColors.destructive.light` value. */
export const accentRamp = {
  50: "#FCF3EF",
  100: "#F8E4DC",
  200: "#F0C9B8",
  300: "#E4A688",
  400: "#CD7C56",
  500: "#AC5B39",
  600: "#9A4930",
  700: "#8A3F29",
  800: "#723421",
  900: "#5C2A1B",
  950: "#3D1B11",
} as const;

// ============================================
// THEME VALUES — hand-tuned HSL, contrast-audited (bun run audit:contrast)
// ============================================

/** Light mode base surfaces + text. */
export const lightPalette = {
  bg: hsl(45, 33, 96), // drafting paper
  surface: hsl(0, 0, 100), // white sheet
  surfaceRaised: hsl(48, 45, 99), // fresh sheet on top
  surfaceSunken: hsl(45, 20, 92), // recessed well — inset rows, code
  border: hsl(45, 6, 52), // standard rule — 3.4:1 on paper
  borderStrong: hsl(45, 8, 30), // heavy rule — inputs, emphasis
  text: hsl(45, 8, 8), // primary ink
  textSecondary: hsl(45, 6, 29), // annotations
  textTertiary: hsl(45, 4, 42), // faint pencil — metadata, captions
  /** Text sat on top of a bright/light accent fill (e.g. warning). */
  textOnLight: hsl(45, 8, 8),
  /** Text sat on top of a solid/dark accent fill (e.g. primary, destructive). */
  textOnDark: hsl(45, 33, 96),
} as const;

/** Dark mode base surfaces + text — the inverted drafting board, not a
 *  literal negative of light mode (each step is independently tuned). */
export const darkPalette = {
  bg: hsl(45, 7, 8), // board
  surface: hsl(45, 6, 11), // sheet
  surfaceRaised: hsl(45, 7, 14), // lifted sheet
  surfaceSunken: hsl(45, 9, 5), // carved well
  border: hsl(45, 5, 40), // standard rule — ~3:1 on board
  borderStrong: hsl(45, 7, 58), // heavy rule
  text: hsl(45, 22, 91), // paper-white ink
  textSecondary: hsl(45, 11, 71),
  textTertiary: hsl(45, 7, 55),
  textOnLight: hsl(45, 7, 9),
  textOnDark: hsl(45, 22, 91),
} as const;

/**
 * Functional accents — primary (the brand slot) + the conventional
 * destructive/success/warning triad. Each carries a light-mode value/hover
 * and a dark-mode value/hover, independently tuned for contrast against
 * their respective theme's surfaces.
 */
export const functionalColors = {
  /** THE brand slot — ink itself, the pen. Buttons, links, focus rings,
   *  active states, charts. Solid ink fill with paper text in light mode;
   *  chalk-bright ink in dark mode. */
  primary: {
    light: hsl(45, 9, 12),
    lightHover: hsl(45, 10, 3),
    dark: hsl(45, 20, 88),
    darkHover: hsl(45, 24, 97),
  },
  /** Destructive / danger. Rust — the one chromatic color in the system,
   *  the red pen. */
  destructive: {
    light: hsl(14, 55, 38), // 5.0:1 with paper text
    lightHover: hsl(14, 60, 31),
    dark: hsl(14, 52, 63),
    darkHover: hsl(13, 58, 71),
  },
  /** Positive / confirmation. Muted drafting green — the approval stamp. */
  success: {
    light: hsl(140, 32, 27),
    lightHover: hsl(140, 36, 21),
    dark: hsl(140, 28, 66),
    darkHover: hsl(139, 32, 74),
  },
  /** Attention / pending. Ink-toned (not chromatic amber) — tuned lighter
   *  than the rest of the light-mode ink scale so it pairs with dark text
   *  under this template's fixed warning/warningForeground contract (see
   *  file header). Dark mode reuses the original chalk-gray value. */
  warning: {
    light: hsl(45, 7, 50),
    lightHover: hsl(45, 8, 43),
    dark: hsl(45, 10, 66),
    darkHover: hsl(45, 12, 74),
  },
} as const;
