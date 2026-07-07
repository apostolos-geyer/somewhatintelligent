/**
 * Sprout Typography Tokens
 *
 * Single source of truth for all type definitions.
 * Codegen reads these to produce CSS utilities and custom properties.
 *
 * Four brand typefaces (per the Sprout brand guidelines) + a mono workhorse:
 *   - Zerove           — rounded unicase display. Headlines, hero, page titles.
 *   - Switzer          — variable grotesque sans. The UI/body workhorse.
 *   - IBM Plex Serif   — light editorial serif. Long-form prose + big quotes.
 *   - Quadrillion      — supporting accent face. Tagline / "learn green" marks.
 *   - Iosevka          — monospace. Code, IDs, timestamps, technical metadata.
 */

// Font stack definitions — CSS var names + actual font family values
export const fontStacks = {
  /** Zerove — rounded display face. Renders effectively unicase; use for
   *  hero/section headers. `font-display` / `font-heading`. */
  display: { cssName: "display", family: "'Zerove', 'Switzer', system-ui, sans-serif" },
  /** Switzer — variable UI/body workhorse. `font-body` / `font-sans`. */
  body: { cssName: "body", family: "'Switzer', system-ui, -apple-system, sans-serif" },
  /** IBM Plex Serif Light — editorial long-form. `font-editorial`. */
  editorial: { cssName: "editorial", family: "'IBM Plex Serif', Georgia, serif" },
  /** Zerove again for headings inside editorial prose. `font-editorial-display`. */
  editorialDisplay: {
    cssName: "editorial-display",
    family: "'Zerove', 'Switzer', system-ui, sans-serif",
  },
  /** Quadrillion — supporting accent face for taglines / playful marks.
   *  `font-accent`. */
  accent: { cssName: "accent", family: "'Quadrillion', 'Zerove', sans-serif" },
  /** Iosevka — monospace. `font-mono`. */
  mono: { cssName: "mono", family: "'Iosevka', ui-monospace, 'SF Mono', monospace" },
} as const;

// ============================================
// Fluid Type — clamp-based, scales with viewport
// For display headlines, editorial prose, hero moments
// ============================================

export interface FluidTypeToken {
  min: number;
  preferred: string;
  max: number;
  weight: number;
  leading: number;
  tracking: number;
  font: keyof typeof fontStacks;
  style?: "italic";
}

export const fluidType = {
  /** Brand hero splash — Zerove, massive rounded display */
  hero: {
    min: 80,
    preferred: "14vw",
    max: 200,
    weight: 400,
    leading: 0.95,
    tracking: 0.005,
    font: "display",
  },
  /** Main page heading — Dashboard, Settings, etc. */
  pageTitle: {
    min: 32,
    preferred: "5vw",
    max: 56,
    weight: 400,
    leading: 1.0,
    tracking: 0.005,
    font: "display",
  },
  /** Dashboard stat numbers — big Zerove numerals */
  stat: {
    min: 28,
    preferred: "4vw",
    max: 48,
    weight: 400,
    leading: 1.0,
    tracking: 0,
    font: "display",
  },
  /** Card display heading, consent screen title, episode title */
  displayTitle: {
    min: 24,
    preferred: "3vw",
    max: 36,
    weight: 400,
    leading: 1.1,
    tracking: 0,
    font: "display",
  },
  /** Blog post / article h1 — Zerove */
  editorialH1: {
    min: 36,
    preferred: "7vw",
    max: 72,
    weight: 400,
    leading: 1.0,
    tracking: 0.005,
    font: "editorialDisplay",
  },
  /** Blog post / article h2 — Zerove */
  editorialH2: {
    min: 28,
    preferred: "4vw",
    max: 42,
    weight: 400,
    leading: 1.1,
    tracking: 0,
    font: "editorialDisplay",
  },
  /** Blog post / article h3 — Zerove */
  editorialH3: {
    min: 22,
    preferred: "3vw",
    max: 30,
    weight: 400,
    leading: 1.2,
    tracking: 0,
    font: "editorialDisplay",
  },
  /** Long-form article body text — IBM Plex Serif Light */
  editorialBody: {
    min: 16,
    preferred: "2vw",
    max: 19,
    weight: 300,
    leading: 1.75,
    tracking: 0,
    font: "editorial",
  },
  /** Article opening paragraph — IBM Plex Serif italic */
  editorialLede: {
    min: 18,
    preferred: "2.5vw",
    max: 22,
    weight: 300,
    leading: 1.7,
    tracking: 0,
    font: "editorial",
    style: "italic",
  },
  /** Pull quote — IBM Plex Serif italic, sprout colored */
  pullquote: {
    min: 24,
    preferred: "4vw",
    max: 40,
    weight: 300,
    leading: 1.32,
    tracking: 0,
    font: "editorial",
    style: "italic",
  },
} as const satisfies Record<string, FluidTypeToken>;

// ============================================
// Fixed Type — discrete sizes, for UI chrome
// Section markers, labels, code
// ============================================

export interface FixedTypeToken {
  size: number;
  weight: number;
  leading: number;
  tracking: number;
  font?: keyof typeof fontStacks;
  transform?: "uppercase";
}

export const fixedType = {
  /** Mono metadata label — timestamps, table headers, field labels */
  monoLabel: {
    size: 11,
    weight: 400,
    leading: 1,
    tracking: 0.06,
    font: "mono",
    transform: "uppercase",
  },
  /** Code blocks, inline code */
  code: {
    size: 14,
    weight: 400,
    leading: 1.6,
    tracking: 0,
    font: "mono",
  },
  /** Section label — story headers, form section dividers, category markers */
  sectionLabel: {
    size: 15,
    weight: 700,
    leading: 1.5,
    tracking: 0.05,
    transform: "uppercase",
  },
} as const satisfies Record<string, FixedTypeToken>;

// ============================================
// UI Type Scale — body font sizes
// These map to Tailwind's text-* but with our leading
// ============================================

export interface UITypeToken {
  size: number;
  leading: number;
}

export const uiType = {
  /** Mono labels, tiny metadata — system minimum */
  "2xs": { size: 11, leading: 1.5 },
  /** Kbd, shortcut hints, tertiary metadata */
  xs: { size: 13, leading: 1.5 },
  /** Descriptions, menu items, compact body, button default */
  sm: { size: 15, leading: 1.5 },
  /** Default body, inputs, labels */
  base: { size: 16, leading: 1.5 },
  /** Card compact titles, emphasized body */
  lg: { size: 18, leading: 1.5 },
  /** Dialog titles, section headings */
  xl: { size: 20, leading: 1.4 },
} as const satisfies Record<string, UITypeToken>;

// ============================================
// Custom Leading (line-height)
// Named values for Tailwind --leading-* namespace
// ============================================

export const customLeading = {
  /** Display hero — extremely tight */
  display: 0.9,
  /** Display headings — very tight */
  "display-tight": 0.95,
  /** Section/card headings */
  heading: 1.1,
  /** Editorial headings */
  "heading-loose": 1.2,
  /** Pull quotes */
  pullquote: 1.3,
  /** Editorial lede */
  "editorial-lede": 1.7,
  /** Editorial body — very open */
  editorial: 1.75,
} as const;

// ============================================
// Custom Tracking (letter-spacing)
// Named values for Tailwind --tracking-* namespace
// ============================================

export const customTracking = {
  /** Hero display — very tight */
  display: "-0.03em",
  /** Page titles, stats — tight */
  "display-tight": "-0.02em",
  /** Section headings — slightly tight */
  heading: "-0.01em",
  /** Uppercase labels, mono labels */
  caps: "0.06em",
} as const;
