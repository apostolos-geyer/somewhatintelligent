/**
 * Google Fonts catalog + URL helpers (PURE — no env, no React, no
 * `cloudflare:workers`). Unit-testable in plain node like `theme-tokens.ts`.
 *
 * The friendly font picker (`ThemeControls`) and the live-portal loader
 * (`BrandFonts`) both derive from this one list, so they can never disagree
 * about which families are offered or how a chosen family maps to a Google Fonts
 * stylesheet request. A theme stores the CSS `stack` string (e.g.
 * "'Inter', sans-serif"); this module maps a stored stack back to its Google
 * family name so the right webfont is fetched wherever the theme is applied.
 */

export type GoogleFontCategory = "Sans serif" | "Serif" | "Display" | "Monospace" | "Handwriting";

export interface GoogleFont {
  /** Google family name, used verbatim (spaces → `+`) in the css2 request. */
  name: string;
  /** CSS font-family stack stored in the theme and emitted to `--font-*`. */
  stack: string;
  category: GoogleFontCategory;
}

const sans = (name: string): GoogleFont => ({
  name,
  stack: `'${name}', sans-serif`,
  category: "Sans serif",
});
const serif = (name: string): GoogleFont => ({
  name,
  stack: `'${name}', serif`,
  category: "Serif",
});
const display = (name: string): GoogleFont => ({
  name,
  stack: `'${name}', sans-serif`,
  category: "Display",
});
const mono = (name: string): GoogleFont => ({
  name,
  stack: `'${name}', monospace`,
  category: "Monospace",
});
const hand = (name: string): GoogleFont => ({
  name,
  stack: `'${name}', cursive`,
  category: "Handwriting",
});

/** A curated, popular subset of the Google Fonts library. Ordered by category so
 *  the picker can group them; extend by adding one entry. */
export const GOOGLE_FONTS: readonly GoogleFont[] = [
  sans("Inter"),
  sans("Roboto"),
  sans("Open Sans"),
  sans("Lato"),
  sans("Montserrat"),
  sans("Poppins"),
  sans("Work Sans"),
  sans("Nunito"),
  sans("Raleway"),
  sans("DM Sans"),
  sans("Manrope"),
  sans("Figtree"),
  sans("Outfit"),
  serif("Playfair Display"),
  serif("Merriweather"),
  serif("Lora"),
  serif("PT Serif"),
  serif("Source Serif 4"),
  serif("Libre Baskerville"),
  display("Oswald"),
  display("Bebas Neue"),
  display("Anton"),
  display("Righteous"),
  display("Archivo Black"),
  mono("JetBrains Mono"),
  mono("Roboto Mono"),
  mono("Space Mono"),
  mono("IBM Plex Mono"),
  mono("Fira Code"),
  mono("DM Mono"),
  hand("Pacifico"),
  hand("Caveat"),
  hand("Dancing Script"),
] as const;

export const GOOGLE_FONT_CATEGORIES: readonly GoogleFontCategory[] = [
  "Sans serif",
  "Serif",
  "Display",
  "Monospace",
  "Handwriting",
];

const BY_STACK = new Map(GOOGLE_FONTS.map((f) => [f.stack, f]));

/** The catalog entry whose stored stack matches `stack` (trimmed), or undefined. */
export function findGoogleFont(stack: string | null | undefined): GoogleFont | undefined {
  if (!stack) return undefined;
  return BY_STACK.get(stack.trim());
}

/** Every catalog family name — for loading all previews in the editor at once. */
export const ALL_GOOGLE_FAMILIES: readonly string[] = GOOGLE_FONTS.map((f) => f.name);

// One reasonable weight ramp for every family: covers body (400), medium (500),
// semibold (600), and bold/display (700) so headings render at the right weight.
const WEIGHTS = "wght@400;500;600;700";

/**
 * Build a Google Fonts css2 stylesheet URL for the given families, or null when
 * there are none. Spaces become `+` per the css2 API; families are
 * de-duplicated. Only the (small) @font-face CSS is fetched up front — the woff2
 * files download lazily per family actually rendered.
 */
export function googleFontsHref(families: readonly string[]): string | null {
  const unique = [...new Set(families)].filter((f) => f.length > 0);
  if (unique.length === 0) return null;
  const params = unique
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:${WEIGHTS}`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

/** The distinct Google family names referenced by a theme's `fonts` bucket. */
export function googleFamiliesInFonts(fonts: Record<string, string> | undefined): string[] {
  if (!fonts) return [];
  const out: string[] = [];
  for (const value of Object.values(fonts)) {
    const f = findGoogleFont(value);
    if (f) out.push(f.name);
  }
  return [...new Set(out)];
}
