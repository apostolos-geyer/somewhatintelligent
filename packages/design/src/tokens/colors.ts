/**
 * Sprout Color Tokens
 *
 * Light-first. Rooted in nature, designed for connection.
 * Warm cream paper surfaces, forest-green ink. A warm espresso canvas
 * for dark mode. Accents named after the cannabis plant — fresh
 * sprout green, growth green, amber pistil, terracotta stigma, purple haze.
 *
 * Official names + hexes are from the Sprout brand guidelines
 * ("Colour Palette — Rooted in Nature. Designed for Connection.").
 *
 * Two layers live here:
 *   1. SEMANTIC tokens (bg/surface/text/border + the 5 accents) that the
 *      product surfaces and codegen consume. This is the source of truth.
 *   2. The RAW brand palette (greens, secondaries, neutrals) is exported
 *      separately so marketing surfaces can reach for a literal brand hex
 *      (e.g. the iconic sprout-lime) without re-deriving it.
 *
 * Light mode is the brand's primary identity; dark mode is a warm espresso canvas.
 * Both are hand-authored first-class themes (no derivation).
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
// RAW BRAND PALETTE — exact hex
//
// Official Sprout brand colours, transcribed VERBATIM (exact hex) from the
// brand guidelines ("Colour Palette — Rooted in Nature. Designed for
// Connection."). This is the pixel-exact source for marketing / illustration
// surfaces and for the codegen's raw `--color-*` utilities.
//
// We store hex DIRECTLY (not via hsl()) on purpose: an HSL round-trip drifts
// 1–4 per channel (e.g. sproutGreen → #CBF17E instead of #C7F27D), which
// breaks pixel parity on hero art, gradients and brand fills.
//
// The SEMANTIC layer below (lightColors/darkColors/accentColors) is a separate,
// hand-authored, WCAG-audited set expressed in HSL. The two layers are
// intentionally distinct: semantic `sprout` is a DEEP growth-green (legible as
// text on cream), while raw `sproutGreen` is the BRIGHT lime hero accent.
// "Sprout Green is too light to be text on white." — brand guidelines.
// ============================================

/** Named primary + secondary + neutral brand colours (exact hex). */
export const brandPalette = {
  // ── Primary — the identity lives in green ──
  /** Fresh, energetic, optimistic — the hero accent, fills, highlights. */
  sproutGreen: "#C7F27D",
  /** Grounded, rich, natural — solid functional green, strong CTAs, links. */
  growthGreen: "#3E9F32",
  /** Calming, balanced, earthy — soft tints & illustration. */
  sativaGreen: "#B2DF93",
  /** Strong, stable, premium — primary ink AND the dark canvas. */
  indicaGreen: "#00240D",

  // ── Secondary — cannabis-derived accents, used sparingly ──
  /** Mystical, premium, distinctive. */
  purpleHaze: "#6D4C7D",
  /** Deep, rich, luxurious. (PDF mislabeled #8B113F; sampled from artwork.) */
  plumKush: "#2E233F",
  /** Soft, uplifting, creative. (PDF mislabeled #8B113F; sampled from artwork.) */
  lilacDiesel: "#AE92C3",
  /** Warm, energetic — amber (also: warning). */
  pistil: "#F4A300",
  /** Warm, earthy, bold — terracotta (also: danger). */
  stigma: "#B85C38",
  /** Soft dusty rose — light accent. */
  trichome: "#D7ADAD",

  // ── Neutral — official 5-step Charcoal → Light ──
  charcoal: "#121412",
  tinder: "#2A2D2A",
  stoned: "#525852",
  kief: "#A9A493",
  /** Warm off-white — the default surface. Alias: paperRamp[100]. */
  light: "#F2F2EC",
  /** Conventional alias of Light. */
  cream: "#F2F2EC",
} as const;

// ── Brand ramps (exact hex) ──
// Tints/shades used across product surfaces (gamification bars, gradients,
// forest-cast UI chrome). Per the guidelines, the `forest` ramp is a working
// green-cast UI ramp (text/borders/surfaces) derived from Indica; it
// COMPLEMENTS — and is separate from — the 5-step Neutral palette above.
// Both are available.

/** Sprout-green ramp — tints/shades of the hero lime. */
export const limeRamp = {
  50: "#F5FCE9",
  100: "#EAF9CE",
  200: "#DAF3A8",
  300: "#C7F27D", // === Sprout Green
  400: "#B2E659",
  500: "#97CE3D",
  600: "#79A82C",
} as const;

/** Growth-green ramp. */
export const growthRamp = {
  300: "#6FC15E",
  400: "#4FAE40",
  500: "#3E9F32", // === Growth Green
  600: "#2F7E27",
  700: "#235E1D",
} as const;

/** Forest neutrals — warm green-black ramp built from Indica. Faint green cast. */
export const forestRamp = {
  50: "#F4F8F5",
  100: "#E9F0EB",
  200: "#D7E3DC",
  300: "#B6CCC0",
  400: "#8AAA9A",
  500: "#5E8770",
  600: "#356B49",
  700: "#1C5733",
  800: "#0E4422",
  900: "#053116",
  950: "#00240D", // === Indica, darkest
} as const;

/** Warm paper neutrals — cream-based, for light UI chrome. */
export const paperRamp = {
  0: "#FFFFFF",
  50: "#FBFBF7",
  100: "#F2F2EC", // === cream / light
  200: "#E7E7DD",
  300: "#D6D6C8",
} as const;

/**
 * Functional status — mapped onto the official palette. No invented colours:
 * success = Growth, warning = Pistil, danger = Stigma, info = Purple Haze.
 * The `*Bg` tints and `*Ink` text colours are the guideline's status pairings.
 */
export const statusColors = {
  success: "#3E9F32",
  successBg: "#E6F4E1",
  warning: "#F4A300",
  warningBg: "#FDEFD2",
  warningInk: "#8A5C00",
  danger: "#B85C38",
  dangerBg: "#F6E5DC",
  dangerInk: "#7E3A20",
  info: "#6D4C7D",
  infoBg: "#EAE3EF",
} as const;

// ============================================
// LIGHT MODE — primary identity
// Warm cream paper, forest-green ink.
// ============================================

export const lightColors = {
  // ── Warm paper surfaces ──
  bg: hsl(60, 23, 94), // cream — the paper itself (#F2F2EC)
  surface: hsl(0, 0, 100), // white card
  surfaceRaised: hsl(60, 33, 98), // lifted cream-white
  surfaceSunken: hsl(140, 22, 96), // forest-50 well — inset rows, code

  // ── Forest borders ── (visible forest mid-tones — meet WCAG 1.4.11 3:1
  //    on cream. The pale forest-200 hairline lives in brandPalette for
  //    marketing surfaces that intentionally want a near-invisible edge.)
  border: hsl(145, 18, 50), // forest line — 3.29:1 on cream
  borderStrong: hsl(150, 22, 42), // input borders — deeper

  // ── Forest ink ──
  text: hsl(143, 100, 7), // indica — primary ink
  textSecondary: hsl(150, 34, 31), // forest-600 — descriptions
  textTertiary: hsl(150, 18, 45), // forest-500 — metadata, captions
  textOnAccent: hsl(60, 23, 94), // cream — text ON deep accent fills
} as const;

// ============================================
// DARK MODE — warm espresso canvas
// The dark inversion of the warm cream paper: a low-saturation warm
// charcoal/espresso (same warm hue family as the cream, just dark), with
// warm off-white ink. NOT a green canvas — green lives only in the accents,
// which glow against the neutral dark.
// ============================================

export const darkColors = {
  // ── Warm espresso surfaces ──
  bg: hsl(40, 14, 8), // espresso — darkest warm neutral
  surface: hsl(40, 11, 12), // raised card base
  surfaceRaised: hsl(38, 10, 16), // lifted
  surfaceSunken: hsl(40, 16, 6), // carved well

  // ── Warm hairlines ── (readable on the espresso canvas: ~3:1)
  border: hsl(40, 8, 28), // warm line
  borderStrong: hsl(40, 8, 38), // input borders — deeper

  // ── Warm cream text ──
  text: hsl(48, 28, 92), // warm off-white ink
  textSecondary: hsl(44, 14, 72), // descriptions
  textTertiary: hsl(42, 11, 56), // metadata, captions
  textOnAccent: hsl(40, 16, 9), // dark warm — text ON bright accent fills
} as const;

// ============================================
// Accents — Sprout
//
// Renamed from the prior mineral set:
//   glyph→sprout, blood→stigma, verdigris→growth, ochre→pistil, slate→haze
//
// Light-mode accents are DEEP (legible cream text reads on their fills);
// dark-mode accents BRIGHTEN (so dark indica text reads, and they glow on
// the forest canvas). This mirrors how the brand uses a deep functional
// green for actions and the bright sprout-lime as a hero glow.
//
//   sprout  — the brand green: primary, interactive, links, focus, CTA
//   stigma  — terracotta: destructive / danger
//   growth  — growth green: success / positive / confirmation
//   pistil  — amber: warning / attention / pending
//   haze    — purple haze: info / neutral-secondary emphasis
// ============================================

export const accentColors = {
  /** Brand green. Primary interactive accent — links, CTAs, focus rings,
   *  active states. Deep growth-green on cream; bright sprout-lime on forest. */
  sprout: {
    light: hsl(122, 55, 28), // deep growth green — 5.64:1 with cream text
    lightHover: hsl(123, 58, 23),
    dark: hsl(80, 81, 72), // sprout-lime glow on forest
    darkHover: hsl(82, 85, 80),
  },
  /** Terracotta. Destructive actions, critical alerts, errors. */
  stigma: {
    light: hsl(17, 56, 40), // deep terracotta — 5.27:1 with cream text
    lightHover: hsl(16, 60, 33),
    dark: hsl(14, 60, 62), // warm clay glow on forest
    darkHover: hsl(13, 64, 70),
  },
  /** Growth green. Success, confirmation, positive deltas, checkmarks. */
  growth: {
    light: hsl(116, 56, 29), // growth green — 5.28:1 with cream text
    lightHover: hsl(117, 60, 24),
    dark: hsl(100, 58, 64), // fresh green on forest
    darkHover: hsl(98, 62, 72),
  },
  /** Amber pistil. Warning, attention-needed, pending.
   *  Light mode is a deep bronze-amber so cream text reads (4.6:1); dark
   *  mode is the bright brand amber with dark indica text. */
  pistil: {
    light: hsl(38, 72, 32), // deep bronze amber — 4.86:1 with cream text
    lightHover: hsl(37, 76, 27),
    dark: hsl(40, 95, 56), // bright amber on forest
    darkHover: hsl(40, 98, 64),
  },
  /** Purple haze. Info, secondary actions, neutral metadata emphasis. */
  haze: {
    light: hsl(283, 34, 37), // deep purple haze — 7.15:1 with cream text
    lightHover: hsl(283, 38, 30),
    dark: hsl(279, 38, 72), // lilac-diesel glow on forest
    darkHover: hsl(279, 42, 80),
  },
} as const;

// ============================================
// Effects
// ============================================

export const effectColors = {
  glass: {
    light: {
      bg: "hsl(60 23% 96% / 0.72)", // frosted warm cream
      border: "hsl(0 0% 100% / 0.6)", // bright glass edge
    },
    dark: {
      bg: "hsl(146 82% 11% / 0.55)", // frosted forest
      border: "hsl(80 81% 72% / 0.16)", // sprout-tinted edge
    },
    blur: "24px",
  },
} as const;

// ============================================
// Exports
// ============================================

/**
 * Light derivation kept for tooling/back-compat. Sprout authors both modes
 * by hand, so this is no longer used to generate light from dark — it simply
 * provides a deterministic inversion for any ad-hoc needs.
 */
function invertForLight(color: HSLColor): HSLColor {
  const l = Math.min(97, Math.max(3, 100 - color.l));
  const s = Math.round(color.s * 0.9);
  return hsl(color.h, s, l);
}

export { invertForLight };
