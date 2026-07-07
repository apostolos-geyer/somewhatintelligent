/**
 * PURE brand helpers — no `cloudflare:workers`, no env, no React. Kept separate
 * from `brand.server.ts` so the host→slug parsing and the runtime-theme → CSS
 * generation (the #1-risk "one engine, infinite skins" mechanism) are trivially
 * unit-testable in plain node, exactly like `policy.server.ts`.
 */
import { SECTION_KEYS, isSectionKey, type SectionKey } from "@/lib/sections";
import {
  THEME_TOKENS,
  colorCssVar,
  globalBucket,
  isColorKey,
  isFontKey,
  isRadiusKey,
  isSpacingKey,
  type ThemeMode,
  type ThemeModePolicy,
} from "@/lib/theme-tokens";

// Re-exported so brand consumers can keep importing it from `@/lib/brand`; the
// literal itself lives in the dependency-free `feed-label` leaf (see that file
// for why schema.ts needs it isolated from the `@/` alias).
export { DEFAULT_FEED_LABEL } from "@/lib/feed-label";

/**
 * A brand's theme overrides (v2). Colour tokens are split into `light`/`dark`
 * palettes (keys ∈ the colour allow-list in `theme-tokens`); radius/spacing/fonts
 * are appearance-invariant buckets. `modePolicy` picks the appearance strategy:
 *  - "adaptive" (default): both palettes; the portal keeps its light/dark toggle.
 *  - "fixed": ONE palette (stored in `light`), appearance pinned to `fixedMode`.
 * Every map is keyed by a registry key and holds a raw CSS value string.
 */
export interface BrandTheme {
  modePolicy?: ThemeModePolicy;
  fixedMode?: ThemeMode;
  light?: Record<string, string>;
  dark?: Record<string, string>;
  radius?: Record<string, string>;
  spacing?: Record<string, string>;
  fonts?: Record<string, string>;
}

/**
 * Build the wire payload for a theme edit: keep only the buckets that are
 * actually set. The editor spreads every slot (`{ light: theme.light, … }`), so
 * unset ones — and ALL of them right after "Reset to defaults" — are `undefined`.
 * TanStack Start's seroval serializer PRESERVES explicit `undefined` props (unlike
 * `JSON.stringify`), and the server's optional-key validator rejects an explicit
 * `undefined` ("light must be an object (was undefined)"); dropping them here is
 * what lets Reset → Save actually clear the draft.
 *
 * Pure + dependency-free on purpose: this module is bundled into the client/SSR
 * graph, so it must NOT pull in arktype — arktype JIT-compiles validators with
 * `new Function`, which the Workers runtime blocks at request time (it 500s every
 * SSR render). Inbound shape validation lives server-only in `brand.functions.ts`.
 */
export function compactTheme(theme: BrandTheme): BrandTheme {
  const out: BrandTheme = {};
  if (theme.modePolicy !== undefined) out.modePolicy = theme.modePolicy;
  if (theme.fixedMode !== undefined) out.fixedMode = theme.fixedMode;
  if (theme.light) out.light = theme.light;
  if (theme.dark) out.dark = theme.dark;
  if (theme.radius) out.radius = theme.radius;
  if (theme.spacing) out.spacing = theme.spacing;
  if (theme.fonts) out.fonts = theme.fonts;
  return out;
}

/** A section's on/off + order, from `portal_config.sections_json`. */
export interface SectionToggle {
  key: SectionKey;
  enabled: boolean;
  order: number;
}

/**
 * The brand SKIN the root route resolves before first paint: identity for the
 * header wordmark plus the live theme. Deliberately slim — portal CONTENT
 * config (tagline, feed label, section toggles) lives in `PortalContent` and is
 * fetched by the portal page in parallel, never on the root/blocking path.
 */
export interface BrandRuntime {
  orgId: string;
  slug: string;
  name: string;
  logoRef: string | null;
  theme: BrandTheme;
}

/**
 * Portal CONTENT config (`portal_config` row) — the page-shape half of the old
 * brand_config. Live-edit (no draft/live); read by the portal shell loader in
 * parallel with banners/roles.
 */
export interface PortalContent {
  /** Hero copy under the wordmark. */
  tagline: string;
  /** The brand-renameable media-feed label ("Enter the Grow" by default). */
  feedLabel: string;
  /** Section toggles (order + enabled). Empty array ⇒ all six default-enabled. */
  sections: SectionToggle[];
}

/** Safe JSON → SectionToggle[]. Drops non-canonical keys; never throws. */
export function parseSections(json: string | null | undefined): SectionToggle[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: SectionToggle[] = [];
    raw.forEach((r, i) => {
      const row = r as Record<string, unknown>;
      if (!isSectionKey(row.key)) return;
      out.push({
        key: row.key,
        enabled: row.enabled !== false,
        order: typeof row.order === "number" ? row.order : i,
      });
    });
    return out;
  } catch {
    return [];
  }
}

/**
 * The ordered list of ENABLED section keys for a brand. An empty/unconfigured
 * toggle set falls back to all six in canonical order (so a fresh brand shows the
 * full grid); otherwise only enabled keys, sorted by `order`.
 */
export function resolveEnabledSections(toggles: SectionToggle[]): SectionKey[] {
  if (toggles.length === 0) return [...SECTION_KEYS];
  return toggles
    .filter((t) => t.enabled)
    .sort((a, b) => a.order - b.order)
    .map((t) => t.key);
}

/**
 * The portal apex(es). Mirror `@greenroom/config` deploy {base,dev}Domain by
 * value so this module stays dependency-free and node-testable. A request to the
 * bare apex resolves to the Hub (brand = null); a `<slug>.<apex>` single-label
 * subdomain resolves to that brand.
 */
const APEX_DOMAINS = [
  // Ordered longest-first: a brand host `<slug>.sprout.<domain>` must match the
  // `sprout.<domain>` apex (leftmost label = <slug>) BEFORE the bare `<domain>`
  // apex. `sprout.<domain>` is the app's own host (SPROUT_URL) in dev (portless)
  // AND prod; the bare domains stay apexes so a `<slug>.<domain>` host resolves too.
  "sprout.sproutportal.ca",
  "sprout.sproutportal.localhost",
  "sproutportal.ca",
  "sproutportal.localhost",
] as const;

/**
 * Extract the brand slug (leftmost label) from a host, or null for the apex/Hub
 * and any non-portal host. Single-label only: `mtl.sproutportal.ca` → "mtl";
 * `a.b.sproutportal.ca` → null; `sproutportal.ca` → null. Port is stripped.
 * Mirrors bouncer's `*.`-wildcard matcher (head non-empty, dot-free).
 */
export function slugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.split(":")[0]!.toLowerCase();
  for (const apex of APEX_DOMAINS) {
    if (h === apex) return null; // apex → Hub
    const suffix = `.${apex}`;
    if (h.endsWith(suffix)) {
      const label = h.slice(0, -suffix.length);
      if (label.length > 0 && !label.includes(".")) return label;
    }
  }
  return null;
}

/** True when the host is the bare portal apex (→ Hub). */
export function isApexHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.split(":")[0]!.toLowerCase();
  return (APEX_DOMAINS as readonly string[]).includes(h);
}

/** Keep only allow-listed string entries from a raw object → a clean key→value
 *  map. Drops non-string values and keys not in the allow-list. */
function pickMap(raw: unknown, allow: (k: string) => boolean): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 0 && allow(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

// Legacy v1 → v2 migration. Old `primary` retinted both modes; `background`
// was light-only; the old `accent` was functionally inert (it aliased
// --color-surface in @theme), so it is dropped.
function migrateThemeV1(raw: Record<string, unknown>): BrandTheme {
  const colors = pickMap(raw.colors, (k) => k === "primary" || k === "background") ?? {};
  const font = pickMap(raw.font, (k) => k === "display" || k === "body") ?? {};
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  if (colors.primary) {
    light.sprout = colors.primary;
    dark.sprout = colors.primary;
  }
  if (colors.background) light.bg = colors.background;
  const fonts: Record<string, string> = {};
  if (font.display) fonts.display = font.display;
  if (font.body) fonts.body = font.body;
  const out: BrandTheme = {};
  if (Object.keys(light).length) out.light = light;
  if (Object.keys(dark).length) out.dark = dark;
  if (Object.keys(fonts).length) out.fonts = fonts;
  return out;
}

const THEME_BUCKETS: ReadonlyArray<
  ["light" | "dark" | "radius" | "spacing" | "fonts", (k: string) => boolean]
> = [
  ["light", isColorKey],
  ["dark", isColorKey],
  ["radius", isRadiusKey],
  ["spacing", isSpacingKey],
  ["fonts", isFontKey],
];

/**
 * Safe JSON → BrandTheme (v2). Never throws; unknown shapes collapse to {}.
 * Filters every map against the token allow-list so the parser, generator, and
 * server validator can never disagree. Migrates the legacy v1 shape
 * (`{ colors: { primary, background }, font: { display, body } }`) to v2.
 */
export function parseBrandTheme(json: string | null | undefined): BrandTheme {
  if (!json) return {};
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object") return {};
  if ("colors" in raw || "font" in raw) return migrateThemeV1(raw);

  const out: BrandTheme = {};
  if (raw.modePolicy === "fixed" || raw.modePolicy === "adaptive") out.modePolicy = raw.modePolicy;
  if (raw.fixedMode === "light" || raw.fixedMode === "dark") out.fixedMode = raw.fixedMode;
  for (const [bucket, allow] of THEME_BUCKETS) {
    const map = pickMap(raw[bucket], allow);
    if (map) out[bucket] = map;
  }
  return out;
}

// Strip anything outside the safe set for CSS values so a brand-config value can
// never break out of the declaration or the <style> element. Quotes are allowed
// (multi-word font families need them); the dangerous breakout chars `; { } < > :`
// and `/` stay forbidden, so `url(...)`, `</style>`, and rule injection are all
// impossible. Defence-in-depth: values are admin-controlled but injected verbatim.
export function sanitizeCssValue(v: string): string {
  return v.replace(/[^A-Za-z0-9 #,.()%_'"-]/g, "").trim();
}

/** The appearance the portal is pinned to, or null for adaptive (toggle stays). */
export function resolveFixedMode(theme: BrandTheme): ThemeMode | null {
  if (theme.modePolicy !== "fixed") return null;
  return theme.fixedMode ?? "light";
}

/** Merge a colour palette map (keyed by colour token key) into a `--var → value`
 *  object, sanitizing values and dropping unknown keys / empties. */
function addColorVars(out: Record<string, string>, palette: Record<string, string> | undefined) {
  if (!palette) return;
  for (const [key, value] of Object.entries(palette)) {
    if (!isColorKey(key)) continue;
    const safe = sanitizeCssValue(value);
    if (safe) out[`--${colorCssVar(key)}`] = safe;
  }
}

/** Merge appearance-invariant tokens (radius/spacing/fonts) into a `--var → value`
 *  object. */
function addGlobalVars(out: Record<string, string>, theme: BrandTheme) {
  for (const t of THEME_TOKENS) {
    const bucket = globalBucket(t.group);
    if (!bucket) continue;
    const map =
      bucket === "radius" ? theme.radius : bucket === "spacing" ? theme.spacing : theme.fonts;
    const value = map?.[t.key];
    if (!value) continue;
    const safe = sanitizeCssValue(value);
    if (safe) out[`--${t.cssVar}`] = safe;
  }
}

function block(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

/**
 * Turn a brand's theme into the `<style>` body that retints the portal by
 * redefining design-system CSS custom properties. Because every overridable
 * token resolves through `var()` (colours, fonts, shadows natively; radius +
 * spacing via the codegen alias — see docs/sprout/11), this single block reskins
 * every utility with no per-component work.
 *
 *  - Global tokens (radius/spacing/fonts) → `:root` (appearance-invariant).
 *  - Adaptive: `light` → `:root`, `dark` → `[data-theme="dark"]`.
 *  - Fixed: the single palette (`light`) is emitted into the selector matching
 *    `fixedMode`; the portal pins `data-theme` so the Sprout base for that mode
 *    fills any un-overridden token (see `resolveFixedMode`).
 *
 * Returns "" when the theme overrides nothing.
 */
export function brandThemeToCss(theme: BrandTheme): string {
  const root: Record<string, string> = {};
  const dark: Record<string, string> = {};
  addGlobalVars(root, theme);

  const fixed = resolveFixedMode(theme);
  if (fixed) {
    addColorVars(fixed === "dark" ? dark : root, theme.light);
  } else {
    addColorVars(root, theme.light);
    addColorVars(dark, theme.dark);
  }

  let css = "";
  if (Object.keys(root).length > 0) css += `:root{${block(root)}}`;
  if (Object.keys(dark).length > 0) css += `[data-theme="dark"]{${block(dark)}}`;
  return css;
}

/**
 * The theme as a flat `--var → value` map for ONE appearance, for applying to a
 * SCOPED element's inline style (e.g. the settings editor's mini-preview) rather
 * than `:root`. Includes the global tokens plus the colour palette for `mode`
 * (or the single fixed palette). The returned object is `Record<string,string>`;
 * cast to `React.CSSProperties` at the call site (this module stays React-free).
 */
export function themeToStyleVars(theme: BrandTheme, mode: ThemeMode): Record<string, string> {
  const out: Record<string, string> = {};
  addGlobalVars(out, theme);
  const fixed = resolveFixedMode(theme);
  addColorVars(out, fixed ? theme.light : theme[mode]);
  return out;
}

/**
 * A brand's identity colour — the retinted `--color-sprout` (Primary) from its
 * parsed theme, returned as a raw CSS value, or null when the brand sets none.
 * The Hub reads this CROSS-BRAND (it can't resolve a per-host skin) to tint each
 * "Your Portals" tile with its own brand colour so disparate brand art still
 * fits the one Sprout-branded surface. Prefers the light palette (the value also
 * seeds dark for a single-primary edit); sanitized so a stored value can never
 * break out of the inline `style`/CSS-var it's injected into. */
export function brandAccent(theme: BrandTheme): string | null {
  const raw = theme.light?.sprout ?? theme.dark?.sprout;
  if (!raw) return null;
  const safe = sanitizeCssValue(raw);
  return safe.length > 0 ? safe : null;
}
