/**
 * Tenant theming — the token registry (SINGLE source of truth).
 *
 * Every design-system token a brand may override is declared here exactly once.
 * The CSS generator (`brandThemeToCss`), the safe parser (`parseBrandTheme`),
 * the editor + FAB controls, and the server-side allow-list all derive from this
 * list — so they can never disagree about which keys are legal or which CSS
 * custom property a key drives. Adding a token = one entry here.
 *
 * PURE: no env, no React, no `cloudflare:workers` — unit-testable in plain node
 * like `brand.ts`.
 */

export type ThemeMode = "light" | "dark";
export type ThemeModePolicy = "adaptive" | "fixed";

export type TokenGroup = "Surfaces" | "Text" | "Accents" | "Radius" | "Spacing" | "Fonts";
export type TokenKind = "color" | "length" | "font";
/** "mode" tokens live under `theme.light` / `theme.dark`; "global" tokens are
 *  appearance-invariant and live in their own bucket (radius/spacing/fonts). */
export type TokenScope = "mode" | "global";

export interface ThemeTokenDef {
  /** Stable key used in the theme JSON maps AND as the allow-list key. For a
   *  colour this is the `--color-<key>` suffix (e.g. `bg`, `sprout-hover`); for a
   *  global token it is the bucket key (e.g. radius `sm`, spacing `base`). */
  key: string;
  /** The CSS custom property this token drives, WITHOUT the leading `--`. */
  cssVar: string;
  label: string;
  group: TokenGroup;
  kind: TokenKind;
  scope: TokenScope;
  /** Default value shown as the control placeholder (global tokens only —
   *  colours fall through to the live Sprout base when unset). */
  hint?: string;
  /** Friendly-control bounds for `length` tokens, in px. The editor renders a px
   *  slider over `[min, max]`; `default` is where the thumb parks while the token
   *  is unset (so it reads as the Sprout base before the admin touches it). */
  slider?: { min: number; max: number; step: number; default: number };
}

const color = (key: string, label: string, group: TokenGroup): ThemeTokenDef => ({
  key,
  cssVar: `color-${key}`,
  label,
  group,
  kind: "color",
  scope: "mode",
});

export const THEME_TOKENS: readonly ThemeTokenDef[] = [
  // ── Surfaces ──────────────────────────────────────────────────────────────
  color("bg", "Background", "Surfaces"),
  color("surface", "Surface", "Surfaces"),
  color("surface-raised", "Surface (raised)", "Surfaces"),
  color("surface-sunken", "Surface (sunken)", "Surfaces"),
  color("border", "Border", "Surfaces"),
  color("border-strong", "Border (strong)", "Surfaces"),
  // ── Text ──────────────────────────────────────────────────────────────────
  color("text", "Text", "Text"),
  color("text-secondary", "Text (secondary)", "Text"),
  color("text-tertiary", "Text (tertiary)", "Text"),
  color("text-on-accent", "Text (on accent)", "Text"),
  // ── Accents ───────────────────────────────────────────────────────────────
  color("sprout", "Primary", "Accents"),
  color("sprout-hover", "Primary (hover)", "Accents"),
  color("growth", "Success", "Accents"),
  color("growth-hover", "Success (hover)", "Accents"),
  color("stigma", "Danger", "Accents"),
  color("stigma-hover", "Danger (hover)", "Accents"),
  color("pistil", "Warning", "Accents"),
  color("pistil-hover", "Warning (hover)", "Accents"),
  color("haze", "Info", "Accents"),
  color("haze-hover", "Info (hover)", "Accents"),
  // ── Radius (global) ─────────────────────────────────────────────────────────
  {
    key: "xs",
    cssVar: "radius-xs",
    label: "Tight (chips, tags)",
    group: "Radius",
    kind: "length",
    scope: "global",
    hint: "6px",
    slider: { min: 0, max: 32, step: 1, default: 6 },
  },
  {
    key: "sm",
    cssVar: "radius-sm",
    label: "Default (buttons, inputs)",
    group: "Radius",
    kind: "length",
    scope: "global",
    hint: "10px",
    slider: { min: 0, max: 32, step: 1, default: 10 },
  },
  {
    key: "md",
    cssVar: "radius-md",
    label: "Cards, menus",
    group: "Radius",
    kind: "length",
    scope: "global",
    hint: "16px",
    slider: { min: 0, max: 48, step: 1, default: 16 },
  },
  {
    key: "lg",
    cssVar: "radius-lg",
    label: "Large cards",
    group: "Radius",
    kind: "length",
    scope: "global",
    hint: "22px",
    slider: { min: 0, max: 48, step: 1, default: 22 },
  },
  {
    key: "xl",
    cssVar: "radius-xl",
    label: "Hero panels",
    group: "Radius",
    kind: "length",
    scope: "global",
    hint: "30px",
    slider: { min: 0, max: 64, step: 1, default: 30 },
  },
  // ── Spacing (global) ────────────────────────────────────────────────────────
  {
    key: "base",
    cssVar: "spacing",
    label: "Density (base unit)",
    group: "Spacing",
    kind: "length",
    scope: "global",
    hint: "0.25rem",
    slider: { min: 2, max: 6, step: 1, default: 4 },
  },
  {
    key: "page",
    cssVar: "spacing-page",
    label: "Page padding",
    group: "Spacing",
    kind: "length",
    scope: "global",
    hint: "clamp(24px, 5vw, 48px)",
    slider: { min: 16, max: 80, step: 4, default: 48 },
  },
  {
    key: "section",
    cssVar: "spacing-section",
    label: "Section gap",
    group: "Spacing",
    kind: "length",
    scope: "global",
    hint: "clamp(24px, 4vw, 48px)",
    slider: { min: 16, max: 80, step: 4, default: 48 },
  },
  {
    key: "grid",
    cssVar: "spacing-grid",
    label: "Grid gap",
    group: "Spacing",
    kind: "length",
    scope: "global",
    hint: "clamp(12px, 2vw, 20px)",
    slider: { min: 8, max: 40, step: 2, default: 20 },
  },
  // ── Fonts (global) ──────────────────────────────────────────────────────────
  {
    key: "display",
    cssVar: "font-display",
    label: "Display font",
    group: "Fonts",
    kind: "font",
    scope: "global",
    hint: "'Zerove', sans-serif",
  },
  {
    key: "body",
    cssVar: "font-body",
    label: "Body font",
    group: "Fonts",
    kind: "font",
    scope: "global",
    hint: "'Switzer', sans-serif",
  },
  {
    key: "mono",
    cssVar: "font-mono",
    label: "Mono font",
    group: "Fonts",
    kind: "font",
    scope: "global",
    hint: "'Iosevka', monospace",
  },
  {
    key: "accent",
    cssVar: "font-accent",
    label: "Accent font",
    group: "Fonts",
    kind: "font",
    scope: "global",
    hint: "'Quadrillion', sans-serif",
  },
] as const;

/** Which `BrandTheme` bucket a global token's value lives in. */
export type GlobalBucket = "radius" | "spacing" | "fonts";

export function globalBucket(group: TokenGroup): GlobalBucket | null {
  if (group === "Radius") return "radius";
  if (group === "Spacing") return "spacing";
  if (group === "Fonts") return "fonts";
  return null;
}

// ── Derived allow-lists (used by the parser, generator, and server validator) ──
export const COLOR_TOKEN_KEYS: readonly string[] = THEME_TOKENS.filter(
  (t) => t.scope === "mode",
).map((t) => t.key);

export const RADIUS_KEYS: readonly string[] = THEME_TOKENS.filter((t) => t.group === "Radius").map(
  (t) => t.key,
);
export const SPACING_KEYS: readonly string[] = THEME_TOKENS.filter(
  (t) => t.group === "Spacing",
).map((t) => t.key);
export const FONT_KEYS: readonly string[] = THEME_TOKENS.filter((t) => t.group === "Fonts").map(
  (t) => t.key,
);

const COLOR_KEY_SET = new Set(COLOR_TOKEN_KEYS);
const RADIUS_KEY_SET = new Set(RADIUS_KEYS);
const SPACING_KEY_SET = new Set(SPACING_KEYS);
const FONT_KEY_SET = new Set(FONT_KEYS);

export function isColorKey(k: string): boolean {
  return COLOR_KEY_SET.has(k);
}
export function isRadiusKey(k: string): boolean {
  return RADIUS_KEY_SET.has(k);
}
export function isSpacingKey(k: string): boolean {
  return SPACING_KEY_SET.has(k);
}
export function isFontKey(k: string): boolean {
  return FONT_KEY_SET.has(k);
}

/** The CSS custom property (without `--`) for a colour key. */
export function colorCssVar(key: string): string {
  return `color-${key}`;
}
/** The CSS custom property (without `--`) for a global bucket key. */
export function globalCssVar(bucket: GlobalBucket, key: string): string | null {
  const def = THEME_TOKENS.find((t) => globalBucket(t.group) === bucket && t.key === key);
  return def ? def.cssVar : null;
}
