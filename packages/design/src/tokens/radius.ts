/**
 * somewhatintelligent Radius Tokens — "DRAFT" (blueprint monochrome)
 *
 * Rounded AND ruled: generous corner radii soften the crisp ink rules —
 * a drafted drawing with a warm hand. `sm` (10px) is THE default for
 * nearly every surface; larger tokens are for bigger cards and panels.
 */

export const radius = {
  /** No rounding — for full-bleed edges only */
  none: 0,
  /** Tight rounding — chips, tiny controls, inline tags */
  xs: 6,
  /** THE default. Every component. Buttons, inputs, badges, small cards. */
  sm: 10,
  /** Cards, sheets, menus */
  md: 16,
  /** Large cards, media frames */
  lg: 22,
  /** Hero panels, feature backdrops, big CTA blocks */
  xl: 30,
  /** Pills — avatars, toggles, segmented controls, fully-round chips */
  full: 9999,
} as const;
