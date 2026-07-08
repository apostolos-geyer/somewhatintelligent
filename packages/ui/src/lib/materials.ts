/**
 * Shared Material Language Styles — "DRAFT" (blueprint monochrome)
 *
 * Surfaces are technical drawings: flat paper, crisp ink rules, sharp
 * (unrounded) container corners. There is NO diffused shadow and NO blur
 * anywhere — depth is drawn with border treatment and hard-offset drafted
 * lines:
 *
 *   solid rule    — reserved for what needs the loudest read: tables,
 *                   destructive/danger states, floating overlays
 *   dashed rule   — the DEFAULT resting state for ordinary content
 *                   surfaces — the visible negative-space grid line
 *   dotted rule   — tertiary / hints / dividers
 *   brutal offset — a hard ink offset (--brutal-*), the drafted "duplicate
 *                   line" that stands a surface off the paper
 *
 * The four material keys (brutal / soft / neo / glass) are kept for
 * backwards compatibility with every consumer:
 *   brutal — solid rule + drafted offset, for emphasis (tables, CTAs)
 *   soft   — the default card look: dashed rule, no offset
 *   neo    — chiseled toggle surfaces (hard 0-blur chisel)
 *   glass  — LEGACY name; renders as an opaque fresh sheet + solid rule
 *
 * `Card`'s `default` variant is `surfaceMaterials.soft` — a plain `<Card>`
 * is dashed unless a caller deliberately opts into `brutal`/`neo`/`glass`.
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
  /** Signature: solid rule + drafted ink offset — the default card */
  brutal: "rounded-md bg-card border-[3px] border-border-strong shadow-brutal-sm",
  /** Soft: quiet secondary sheet — dashed rule, flat */
  soft: "rounded-md border-2 border-dashed border-border bg-surface-raised",
  /** Neo raised: chiseled, standing proud of the paper */
  neo: "rounded-md border-2 border-border bg-surface shadow-neo-raised",
  /** Neo inset: pressed/sunken into the paper */
  neoInset: "rounded-md border-2 border-border bg-surface-sunken shadow-neo-inset",
  /** Legacy "glass": an opaque fresh sheet with a solid rule (flat) */
  glass: "rounded-md glass",
} as const;

// ============================================
// Interactive materials — with hover/active states
// ============================================

export const interactiveMaterials = {
  /** Signature: drafted offset that grows on hover and collapses on press —
   *  the element physically sits down on the paper. Card-tile interaction —
   *  consumed only by clickable card surfaces (never buttons/badges), so it
   *  rounds on the `md` Cards token like the surfaces. */
  brutal:
    "rounded-md border-[3px] border-border-strong shadow-brutal-sm transition-all hover:shadow-brutal-md hover:-translate-x-0.5 hover:-translate-y-0.5 active:shadow-none active:translate-x-0.5 active:translate-y-0.5",
  /** Soft: dashed affordance that commits to a solid rule on hover */
  soft: "rounded-sm border-2 border-dashed border-border transition-colors hover:[border-style:solid] hover:border-border-strong active:press-in",
  /** Neo: chisel flips inset on active */
  neo: "rounded-sm border-2 border-border shadow-neo-raised hover:shadow-neo-inset active:shadow-neo-inset active:press-in",
  /** Legacy "glass": flat sheet; rule strengthens on hover */
  glass: "rounded-sm glass transition-colors hover:border-border-strong active:press-in",
} as const;

// ============================================
// Compact materials — for small elements (badges)
// ============================================

export const compactMaterials = {
  /** Solid rule + tiny drafted offset */
  brutal: "border-2 border-border-strong shadow-brutal-sm",
  /** Legacy "glass": opaque sheet chip with a solid rule */
  glass: "glass",
} as const;

export type SurfaceMaterial = keyof typeof surfaceMaterials;
export type InteractiveMaterial = keyof typeof interactiveMaterials;
export type CompactMaterial = keyof typeof compactMaterials;
