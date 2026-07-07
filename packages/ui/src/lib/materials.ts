/**
 * Shared Material Language Styles — Sprout
 *
 * Sprout's surfaces are warm, soft, and friendly: gently-rounded cards
 * that lift on hover and press in when activated. There is no hard
 * brutalist stone here — elevation is conveyed with soft, diffused
 * shadows, and depth with neumorphism and frosted glass.
 *
 * The four material keys (brutal / soft / neo / glass) are kept for
 * backwards compatibility with every consumer; `brutal` is now Sprout's
 * primary "signature" feel (a confident soft elevation), NOT a hard
 * offset. Components compose these strings with their own overrides.
 *
 * Surface = static containers (cards, alerts).
 * Interactive = elements with hover/active states (buttons, badges).
 */

// ============================================
// Surface materials — for static containers
// ============================================

// Cards/surfaces round on the `md` (Cards) radius token, not `sm` (small
// controls) — so a brand's "Cards, menus" radius knob (--radius-md) reaches
// every composed card. The Card primitive base is already rounded-md; these
// material strings are appended last in cn()/twMerge, so they must match or
// they silently downgrade every card back to the control radius.
export const surfaceMaterials = {
  /** Signature: soft, confident elevation — the default card */
  brutal: "rounded-md bg-card border border-border shadow-soft-md",
  /** Soft: gentle elevation, subtle border */
  soft: "rounded-md border border-border bg-surface-raised shadow-soft-lg",
  /** Neumorphic raised: standing proud of surface */
  neo: "rounded-md border-none bg-surface shadow-neo-raised",
  /** Neumorphic inset: pressed/sunken into surface */
  neoInset: "rounded-md border-none bg-surface shadow-neo-inset",
  /** Glass: frosted translucent backdrop */
  glass: "rounded-md glass",
} as const;

// ============================================
// Interactive materials — with hover/active states
// ============================================

export const interactiveMaterials = {
  /** Signature: soft elevation, gentle lift on hover, press-in on active.
   *  Card-tile interaction — consumed only by clickable card surfaces (never
   *  buttons/badges), so it rounds on the `md` Cards token like the surfaces. */
  brutal:
    "rounded-md shadow-soft-md transition-all hover:shadow-soft-lg hover:-translate-y-0.5 active:shadow-soft-sm active:translate-y-0 active:press-in",
  /** Soft: press-in active state */
  soft: "rounded-sm border border-border shadow-soft-md hover:shadow-soft-lg active:shadow-soft-sm active:press-in",
  /** Neumorphic: inset flip on active */
  neo: "rounded-sm border-none shadow-neo-raised hover:shadow-neo-inset active:shadow-neo-inset active:press-in",
  /** Glass: brightness shift + press-in */
  glass:
    "rounded-sm glass shadow-soft-md hover:shadow-soft-lg hover:brightness-110 active:shadow-soft-sm active:press-in",
} as const;

// ============================================
// Compact materials — for small elements (badges)
// ============================================

export const compactMaterials = {
  /** Soft: hairline border + small soft shadow */
  brutal: "border border-border shadow-soft-sm",
  /** Glass: frosted translucent */
  glass: "glass",
} as const;

export type SurfaceMaterial = keyof typeof surfaceMaterials;
export type InteractiveMaterial = keyof typeof interactiveMaterials;
export type CompactMaterial = keyof typeof compactMaterials;
