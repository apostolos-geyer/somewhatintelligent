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
 * somewhatintelligent ("FRIEND" — syntax-highlight terminal): the UI is a
 * code editor, not a drafting board. `neutralRamp` is a cool near-black →
 * near-white "canvas" continuum (steps 50-300 the light-terminal end,
 * 400-950 the black-shirt end — 950 is the actual shirt black); `accentRamp`
 * is hot pink — the flagship chromatic color, lifted straight off the
 * `friend` keyword on the shirt that funds this store — and now drives
 * `functionalColors.primary` directly (unlike the old neutral-ink brand,
 * this one is unapologetically loud). `destructive`/`success`/`warning` are
 * tuned as their own hues (red/green/amber) rather than derived from
 * `accentRamp`, so a pink CTA next to a red delete button never gets
 * confused for the same affordance — the classic syntax-highlighter
 * palette, not a monochrome one. `warning` is deliberately tuned as a light
 * tone in BOTH themes: this template's fixed semantic contract
 * (src/tokens/colors.ts) always pairs `warningForeground` with dark text, so
 * the fill itself must read as light even in dark mode (unlike primary/
 * destructive/success, which are bright solids with dark text in dark
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

/** Neutral grayscale — a cool near-black → near-white canvas continuum.
 *  Steps 50-300 are the light-terminal end; 400-950 are the black-shirt end
 *  (950 is the exact ink of the shirt this store is named after). */
export const neutralRamp = {
  50: "#F7F8FA",
  100: "#EEF0F4",
  200: "#E1E4EA",
  300: "#C9CDD8",
  400: "#9AA1B0",
  500: "#767D8C",
  600: "#565C68",
  700: "#3D4149",
  800: "#282B31",
  900: "#17181C",
  950: "#0B0C0E",
} as const;

/** Pink — the flagship chromatic color (the `friend` keyword, lifted off
 *  the shirt), driving `functionalColors.primary`. Full illustration ramp
 *  graduated around the base pink hue (~330°); step 500 is roughly the
 *  `functionalColors.primary.light` value, step 300 roughly
 *  `functionalColors.primary.dark`. */
export const accentRamp = {
  50: "#FFF0F8",
  100: "#FFDCEF",
  200: "#FFB8E0",
  300: "#FF8ECE",
  400: "#FF66BC",
  500: "#FF3DA6",
  600: "#E81C8C",
  700: "#C10F73",
  800: "#970B5A",
  900: "#6E0842",
  950: "#45052A",
} as const;

// ============================================
// THEME VALUES — hand-tuned HSL, contrast-audited (bun run audit:contrast)
// ============================================

/** Light mode base surfaces + text — a light-terminal theme, not a retreat
 *  to paper. Cool, slightly blue-gray neutrals. */
export const lightPalette = {
  bg: hsl(220, 20, 97), // light-terminal canvas
  surface: hsl(0, 0, 100), // white sheet
  surfaceRaised: hsl(220, 25, 100), // fresh sheet on top
  surfaceSunken: hsl(220, 18, 93), // recessed well — inset rows, code blocks
  border: hsl(220, 12, 52), // standard rule — ~3.2:1 on canvas
  borderStrong: hsl(220, 15, 35), // heavy rule — inputs, emphasis
  text: hsl(224, 20, 10), // primary ink
  textSecondary: hsl(224, 12, 32), // annotations
  textTertiary: hsl(224, 8, 46), // faint — metadata, captions
  /** Text sat on top of a bright/light accent fill (e.g. warning). */
  textOnLight: hsl(224, 20, 10),
  /** Text sat on top of a solid/dark accent fill (e.g. primary, destructive). */
  textOnDark: hsl(220, 25, 97),
} as const;

/** Dark mode base surfaces + text — the flagship theme: the black shirt as
 *  a UI. Not a literal negative of light mode (each step independently
 *  tuned). */
export const darkPalette = {
  bg: hsl(230, 12, 7), // the shirt — near-black, faint cool cast
  surface: hsl(228, 11, 10), // sheet
  surfaceRaised: hsl(227, 10, 13), // lifted sheet
  surfaceSunken: hsl(230, 14, 5), // carved well — code blocks, terminal panes
  border: hsl(225, 10, 44), // standard rule — ~3:1 on canvas, ~3:1 on sidebar
  borderStrong: hsl(220, 12, 55), // heavy rule
  text: hsl(220, 25, 96), // the shirt's white text
  textSecondary: hsl(220, 12, 75),
  textTertiary: hsl(220, 8, 55),
  textOnLight: hsl(230, 12, 8),
  textOnDark: hsl(220, 25, 96),
} as const;

/**
 * Functional accents — primary (the brand slot) + the conventional
 * destructive/success/warning triad, tuned as a syntax-highlighter palette:
 * pink keyword, red error, green success, amber warning. Each carries a
 * light-mode value/hover and a dark-mode value/hover, independently tuned
 * for contrast against their respective theme's surfaces.
 */
export const functionalColors = {
  /** THE brand slot — the `friend` keyword pink. Buttons, links, focus
   *  rings, active states, charts. Deep saturated pink fill with near-white
   *  text in light mode; bright chalk pink with near-black text in dark
   *  mode (mirrors the shirt's pink-on-black). */
  primary: {
    light: hsl(330, 82, 42),
    lightHover: hsl(330, 86, 34),
    dark: hsl(330, 90, 72),
    darkHover: hsl(330, 95, 80),
  },
  /** Destructive / danger. Terminal red — its own hue, never confusable
   *  with the pink primary. */
  destructive: {
    light: hsl(0, 70, 45), // ~4.8:1 with near-white text
    lightHover: hsl(0, 75, 38),
    dark: hsl(0, 85, 68),
    darkHover: hsl(0, 90, 75),
  },
  /** Positive / confirmation. Terminal green — the "tests passed" color. */
  success: {
    light: hsl(142, 65, 28),
    lightHover: hsl(142, 70, 22),
    dark: hsl(142, 60, 62),
    darkHover: hsl(142, 65, 70),
  },
  /** Attention / pending. Terminal amber — tuned as a light tone in BOTH
   *  themes so it pairs with dark text under this template's fixed
   *  warning/warningForeground contract (see file header). */
  warning: {
    light: hsl(36, 85, 38),
    lightHover: hsl(36, 82, 32),
    dark: hsl(45, 90, 68),
    darkHover: hsl(45, 92, 75),
  },
} as const;
