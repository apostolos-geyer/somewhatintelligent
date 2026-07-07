/**
 * Sprout brand tokens for the marketing videos.
 *
 * Mirrors the real design system in
 * `packages/design/src/tokens/colors.ts` (dark "warm espresso" canvas with a
 * sprout-lime glow) so the films are brand-accurate, not a guess. The marketing
 * surfaces deliberately use the DARK theme: espresso canvas, cream ink, green
 * accents that glow.
 */

// ── Canvas (dark / espresso) ──
export const bg = "hsl(40, 14%, 8%)"; // espresso — darkest warm neutral
export const bgDeep = "hsl(40, 16%, 6%)"; // carved well / vignette floor
export const surface = "hsl(40, 11%, 12%)"; // raised card base
export const surfaceRaised = "hsl(38, 10%, 16%)"; // lifted
export const border = "hsl(40, 8%, 28%)"; // warm hairline
export const borderStrong = "hsl(40, 8%, 38%)";

// ── Ink ──
export const text = "hsl(48, 28%, 92%)"; // warm off-white
export const textSecondary = "hsl(44, 14%, 72%)";
export const textTertiary = "hsl(42, 11%, 56%)";

// ── Accents (dark-mode, the glowing set) ──
export const sprout = "hsl(80, 81%, 72%)"; // sprout-lime glow — the hero accent
export const sproutDeep = "hsl(122, 55%, 28%)"; // deep growth green (fills)
export const growth = "hsl(100, 58%, 64%)"; // success green
export const pistil = "hsl(40, 95%, 56%)"; // amber — attention / live
export const haze = "hsl(279, 38%, 72%)"; // lilac haze — info
export const stigma = "hsl(14, 60%, 62%)"; // clay — live/danger tag

/** Soft sprout-green glow, used behind hero CTAs and the wordmark. */
export const brandGlow = "0 0 80px hsl(115 60% 45% / 0.45)";

// Brand typefaces (loaded locally in src/load-fonts.ts).
export const fonts = {
  display: "Zerove, system-ui, sans-serif", // rounded unicase display
  sans: "Switzer, system-ui, sans-serif", // UI / body workhorse
  accent: "Quadrillion, Zerove, sans-serif", // taglines / marks
  mono: "Iosevka, ui-monospace, monospace", // hosts, metadata
};

/**
 * White-label demo skins. The product's headline claim is "one engine, infinite
 * skins" — these are the three brands walked through the journey report
 * (MTL black+green, Dom Jackson purple, Lite Label navy).
 */
export type Skin = {
  id: string;
  name: string;
  tagline: string;
  bg: string;
  bgDeep: string;
  surface: string;
  accent: string;
  accentSoft: string;
  text: string;
};

export const skins: Skin[] = [
  {
    id: "MTL",
    name: "MTL Cannabis",
    tagline: "Montreal Cultivated",
    bg: "hsl(140, 12%, 7%)",
    bgDeep: "hsl(140, 16%, 4%)",
    surface: "hsl(140, 10%, 12%)",
    accent: "hsl(96, 78%, 62%)",
    accentSoft: "hsl(96, 60%, 40%)",
    text: "hsl(90, 20%, 94%)",
  },
  {
    id: "DOMJ",
    name: "Dom Jackson",
    tagline: "Cultivated Character",
    bg: "hsl(276, 22%, 9%)",
    bgDeep: "hsl(276, 30%, 5%)",
    surface: "hsl(276, 18%, 14%)",
    accent: "hsl(279, 70%, 74%)",
    accentSoft: "hsl(279, 45%, 50%)",
    text: "hsl(280, 24%, 95%)",
  },
  {
    id: "LL",
    name: "Lite Label",
    tagline: "Clean & Considered",
    bg: "hsl(218, 30%, 9%)",
    bgDeep: "hsl(218, 38%, 5%)",
    surface: "hsl(218, 24%, 14%)",
    accent: "hsl(199, 90%, 64%)",
    accentSoft: "hsl(205, 60%, 46%)",
    text: "hsl(210, 30%, 96%)",
  },
];
