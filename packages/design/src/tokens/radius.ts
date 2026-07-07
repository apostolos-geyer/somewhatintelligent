/**
 * Sprout Radius Tokens
 *
 * The system is soft and friendly. Generous rounding mirrors the rounded
 * geometry of the Sprout logo and the brand's "designed for connection"
 * warmth. `sm` (10px) is THE default for nearly every surface; larger
 * tokens are for bigger cards and hero panels.
 *
 * Values mirror the Sprout brand guidelines' radius scale
 * (--r-xs … --r-pill).
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
