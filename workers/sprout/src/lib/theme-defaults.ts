/**
 * The live Sprout design-system default for every colour token, per appearance.
 *
 * The theme editor stores ONLY overrides — an unset colour token round-trips to
 * whatever the Sprout base CSS resolves it to (see `brand.ts`). That makes the
 * editor's colour controls read as "empty" with no hint of what the default
 * actually looks like, so an unset swatch fell back to a generic grey.
 *
 * This module resolves each colour token key back to its real design-system hex
 * (the SAME values codegen emits into `--color-*`), so the editor can paint an
 * unset control with the true Sprout default instead of grey.
 *
 * Source of truth: `@greenroom/design`'s semantic colour tokens. PURE data — no
 * env/React/cloudflare — so it stays node-testable like the rest of `lib`.
 */
import { accentColors, darkColors, lightColors } from "@greenroom/design/tokens/colors";
import type { ThemeMode } from "@/lib/theme-tokens";

/** Registry colour key → the neutral token it maps to in the design palette.
 *  (Kebab editor keys vs. the design tokens' camelCase fields.) */
const NEUTRAL_KEYS: Record<string, keyof typeof lightColors> = {
  bg: "bg",
  surface: "surface",
  "surface-raised": "surfaceRaised",
  "surface-sunken": "surfaceSunken",
  border: "border",
  "border-strong": "borderStrong",
  text: "text",
  "text-secondary": "textSecondary",
  "text-tertiary": "textTertiary",
  "text-on-accent": "textOnAccent",
};

/**
 * The Sprout default for a colour token key in the given appearance, as a
 * `#rrggbb` hex (what the native colour picker needs), or null when the key is
 * not a known colour token. Accent keys carry a `-hover` variant.
 */
export function defaultColorHex(key: string, mode: ThemeMode): string | null {
  const neutral = NEUTRAL_KEYS[key];
  if (neutral) {
    return (mode === "dark" ? darkColors : lightColors)[neutral].hex;
  }
  const isHover = key.endsWith("-hover");
  const base = isHover ? key.slice(0, -"-hover".length) : key;
  const accent = (accentColors as Record<string, (typeof accentColors)["sprout"]>)[base];
  if (!accent) return null;
  if (mode === "dark") return (isHover ? accent.darkHover : accent.dark).hex;
  return (isHover ? accent.lightHover : accent.light).hex;
}
