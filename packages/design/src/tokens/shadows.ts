/**
 * Platform Shadow Tokens — "DRAFT" (blueprint monochrome)
 *
 * There are NO soft shadows and NO blur anywhere in this system. Depth is
 * drawn, not diffused: every former shadow family now resolves to crisp,
 * zero-blur ink lines, and real elevation should be expressed with border
 * treatment (solid / dashed / dotted — see DESIGN_SYSTEM.md).
 *
 * The families keep their historical names/keys so the generated CSS
 * variable surface (--brutal-*, --soft-*, --neo-*, --glass-*) stays stable
 * for consumers, but their VALUES are all hard-edged:
 * - Brutal: hard ink offset — a drafted duplicate line. The primary
 *   "elevation" effect for cards/CTAs that want weight.
 * - Soft: a single hard rule under the element (blur 0). Legacy slots;
 *   prefer borders.
 * - Neo: hard chisel for toggle-like elements (blur 0).
 * - Glass: dead — zero size, zero opacity.
 *
 * Every CSS variable name is derived from token keys here.
 * Codegen must not hardcode any shadow variable names.
 */

// ============================================
// Brutal — hard offset ink lines (the blueprint elevation)
// Keys become CSS vars: --{familyPrefix}-{key}
// ============================================

export const brutalShadows = {
  sm: { x: 2, y: 2 },
  md: { x: 4, y: 4 },
  lg: { x: 6, y: 6 },
} as const;

// ============================================
// Soft — LEGACY slots, now hard single rules (blur 0)
// Keys become CSS vars: --{familyPrefix}-{key}
// ============================================

export const softShadows = {
  sm: {
    layers: [{ y: 1, blur: 0, opacity: 0.3 }],
  },
  md: {
    layers: [{ y: 3, blur: 0, opacity: 0.25 }],
  },
  lg: {
    layers: [{ y: 5, blur: 0, opacity: 0.22 }],
  },
} as const;

// ============================================
// Neumorphic — hard chisel (blur 0), toggle-like elements
// Variant keys (raised, inset) become CSS vars: --{familyPrefix}-{key}
// ============================================

export const neoShadows = {
  /** HSL base colors for the two directions */
  colors: {
    light: { darkHsl: "45 8% 8%", lightHsl: "0 0% 100%" },
    dark: { darkHsl: "0 0% 0%", lightHsl: "0 0% 100%" },
  },
  light: {
    raised: {
      dark: { x: 2, y: 2, blur: 0, opacity: 0.25 },
      light: { x: -1, y: -1, blur: 0, opacity: 0.9 },
    },
    inset: {
      dark: { x: 1, y: 1, blur: 0, opacity: 0.25 },
      light: { x: -1, y: -1, blur: 0, opacity: 0.7 },
    },
  },
  dark: {
    raised: {
      dark: { x: 3, y: 3, blur: 0, opacity: 0.6 },
      light: { x: -1, y: -1, blur: 0, opacity: 0.06 },
    },
    inset: {
      dark: { x: 2, y: 2, blur: 0, opacity: 0.6 },
      light: { x: -1, y: -1, blur: 0, opacity: 0.05 },
    },
  },
} as const;

// ============================================
// Glass — dead. Zero blur, zero opacity (flat system).
// ============================================

export const glassShadow = {
  blur: 0,
  opacity: 0,
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
// ============================================

export const softShadowColors = {
  /** Dark mode: pure black base */
  darkHsl: "0 0% 0%",
} as const;
