/**
 * Platform Shadow Tokens
 *
 * Three families with semantic purpose:
 * - Brutal: hard offset, conveys weight and permanence
 * - Soft: diffused elevation, for secondary/receding surfaces
 * - Neo: raised/inset, for toggle-like interactive elements
 *
 * Shadow color references are relative to the current theme
 * (light vs dark mode), so these are templates — the actual
 * CSS values are computed in codegen using the color tokens.
 *
 * Every CSS variable name is derived from token keys here.
 * Codegen must not hardcode any shadow variable names.
 */

// ============================================
// Brutal — hard offset shadows
// Keys become CSS vars: --{familyPrefix}-{key}
// ============================================

export const brutalShadows = {
  sm: { x: 2, y: 2 },
  md: { x: 4, y: 4 },
  lg: { x: 6, y: 6 },
} as const;

// ============================================
// Soft — diffused elevation shadows
// Keys become CSS vars: --{familyPrefix}-{key}
// ============================================

export const softShadows = {
  sm: {
    layers: [
      { y: 1, blur: 3, opacity: 0.06 },
      { y: 1, blur: 2, opacity: 0.04 },
    ],
  },
  md: {
    layers: [
      { y: 4, blur: 8, opacity: 0.08 },
      { y: 2, blur: 4, opacity: 0.04 },
    ],
  },
  lg: {
    layers: [
      { y: 12, blur: 24, opacity: 0.1 },
      { y: 4, blur: 8, opacity: 0.05 },
    ],
  },
} as const;

// ============================================
// Neumorphic — raised/inset shadows
// Variant keys (raised, inset) become CSS vars: --{familyPrefix}-{key}
// ============================================

export const neoShadows = {
  /** HSL base colors for the two light directions in neumorphic shadows */
  colors: {
    /** Light mode: dark direction uses theme text color, highlight uses white */
    light: { darkHsl: "60 90% 5%", lightHsl: "0 0% 100%" },
    /** Dark mode: dark direction uses pure black, highlight uses white */
    dark: { darkHsl: "0 0% 0%", lightHsl: "0 0% 100%" },
  },
  light: {
    raised: {
      dark: { x: 4, y: 4, blur: 8, opacity: 0.08 },
      light: { x: -2, y: -2, blur: 6, opacity: 0.7 },
    },
    inset: {
      dark: { x: 2, y: 2, blur: 5, opacity: 0.08 },
      light: { x: -2, y: -2, blur: 5, opacity: 0.6 },
    },
  },
  dark: {
    raised: {
      dark: { x: 6, y: 6, blur: 14, opacity: 0.5 },
      light: { x: -3, y: -3, blur: 10, opacity: 0.04 },
    },
    inset: {
      dark: { x: 3, y: 3, blur: 8, opacity: 0.5 },
      light: { x: -3, y: -3, blur: 8, opacity: 0.03 },
    },
  },
} as const;

// ============================================
// Glass — subtle drop shadow on translucent surfaces
// ============================================

export const glassShadow = {
  blur: 12,
  opacity: 0.15,
} as const;

// ============================================
// Shadow family registry — defines CSS variable prefixes
// Codegen iterates this to generate variable names.
// ============================================

export const shadowFamilies = {
  brutal: "brutal",
  soft: "soft",
  neo: "neo",
  glass: "glass",
} as const;

// ============================================
// Soft shadow base colors per theme
// Used by codegen to determine the HSL base for soft shadows
// ============================================

export const softShadowColors = {
  /** Dark mode: pure black base for soft shadows */
  darkHsl: "0 0% 0%",
} as const;
