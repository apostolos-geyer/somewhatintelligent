/**
 * somewhatintelligent Radius Tokens — "DRAFT" (blueprint monochrome)
 *
 * Sharp sections, soft controls: containers are unrounded — borders alone
 * carry structure there, the way a blueprint's ruled lines do. Small
 * interactive controls (buttons, badges, avatars, inputs, checkboxes,
 * switches, radios) keep their rounding; `sm` (10px) is THE default for
 * those.
 */

export const radius = {
  /** No rounding — for full-bleed edges only */
  none: 0,
  /** Tight rounding — chips, tiny controls, inline tags */
  xs: 6,
  /** THE default. Every control. Buttons, inputs, badges, small chips. */
  sm: 10,
  /** Cards, sheets, menus — sharp. Borders carry structure, not rounding. */
  md: 0,
  /** Large cards, media frames — sharp, same as `md`. */
  lg: 0,
  /** Hero panels, feature backdrops, big CTA blocks */
  xl: 30,
  /** Pills — avatars, toggles, segmented controls, fully-round chips */
  full: 9999,
} as const;
