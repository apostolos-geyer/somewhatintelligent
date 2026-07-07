import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Input } from "@greenroom/ui/components/input";
import { Label } from "@greenroom/ui/components/label";
import { Slider } from "@greenroom/ui/components/slider";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@greenroom/ui/components/select";
import { cn } from "@greenroom/ui/lib/utils";
import type { BrandTheme } from "@/lib/brand";
import {
  THEME_TOKENS,
  globalBucket,
  type ThemeMode,
  type ThemeTokenDef,
  type TokenGroup,
} from "@/lib/theme-tokens";
import {
  ALL_GOOGLE_FAMILIES,
  GOOGLE_FONTS,
  GOOGLE_FONT_CATEGORIES,
  findGoogleFont,
  googleFontsHref,
} from "@/lib/google-fonts";
import { defaultColorHex } from "@/lib/theme-defaults";

/**
 * Registry-driven theme editor body. Renders ONE friendly control per
 * `THEME_TOKENS` entry, grouped, with no knowledge of which token exists — the
 * registry is the single source of truth, so the settings editor and the
 * demo-mode FAB share this exact control set. State-based (plain `BrandTheme` in
 * / `onChange` out), not form-bound, so it drops into either surface.
 *
 * No control expects the admin to type CSS:
 *  - colours    → an OS colour picker + a row of one-click swatch presets;
 *  - radius/spacing → a px slider with a live readout (drag, don't type a length);
 *  - fonts      → a Google Fonts dropdown that previews each family in its own face.
 *
 * `mode` selects which colour palette (`light`/`dark`) the colour controls edit;
 * radius/spacing/font controls are appearance-invariant and ignore it.
 */

const GROUP_ORDER: readonly TokenGroup[] = [
  "Surfaces",
  "Text",
  "Accents",
  "Radius",
  "Spacing",
  "Fonts",
] as const;

/** One-click colour presets: neutrals, then a friendly spread of accent hues. */
const COLOR_PRESETS: readonly string[] = [
  "#0b0b0c",
  "#161618",
  "#52525b",
  "#a1a1aa",
  "#f4f4f5",
  "#ffffff",
  "#7bc24e",
  "#22c55e",
  "#0ea5e9",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#ef4444",
  "#f97316",
  "#eab308",
];

/** Sentinel for the "unset → Sprout default" font option (base-ui needs a
 *  non-empty value, and an empty string isn't selectable). */
const FONT_DEFAULT = "__default__";

/** Read the current override for a token (empty string = unset → Sprout base). */
function tokenValue(theme: BrandTheme, def: ThemeTokenDef, mode: ThemeMode): string {
  if (def.scope === "mode") return theme[mode]?.[def.key] ?? "";
  const bucket = globalBucket(def.group);
  if (!bucket) return "";
  return theme[bucket]?.[def.key] ?? "";
}

/** Immutably set/clear a token override, dropping empty maps so the stored JSON
 * stays clean and "unset" round-trips to the live Sprout base. */
export function setThemeToken(
  theme: BrandTheme,
  def: ThemeTokenDef,
  mode: ThemeMode,
  value: string,
): BrandTheme {
  const v = value.trim();
  const bucketKey: "light" | "dark" | "radius" | "spacing" | "fonts" =
    def.scope === "mode" ? mode : globalBucket(def.group)!;
  const next = { ...theme[bucketKey] } as Record<string, string>;
  if (v) next[def.key] = v;
  else delete next[def.key];
  return { ...theme, [bucketKey]: Object.keys(next).length > 0 ? next : undefined };
}

/** True when the theme overrides nothing — i.e. it's already all Sprout defaults
 *  (no palettes, no global tokens, and the default adaptive appearance policy). */
export function isThemeEmpty(theme: BrandTheme): boolean {
  return (
    theme.modePolicy === undefined &&
    theme.fixedMode === undefined &&
    !theme.light &&
    !theme.dark &&
    !theme.radius &&
    !theme.spacing &&
    !theme.fonts
  );
}

/** Parse a plain `<number>px` length to its number, or null for unset/complex
 *  (e.g. a `clamp(…)` default) values the slider can't represent. */
function parsePx(value: string): number | null {
  const m = value.trim().match(/^(\d+(?:\.\d+)?)px$/);
  return m ? Number(m[1]) : null;
}

/** A tiny "revert to the Sprout default" affordance shown only when a token is
 *  overridden. */
function ResetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="shrink-0 rounded-xs p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <RotateCcw className="size-3.5" aria-hidden />
    </button>
  );
}

/** Colour control: OS colour picker + hex field + one-click swatch presets. */
function ColorControl({
  def,
  value,
  mode,
  onChange,
}: {
  def: ThemeTokenDef;
  value: string;
  mode: ThemeMode;
  onChange: (value: string) => void;
}) {
  const id = `token-${def.cssVar}`;
  // While unset, the picker + placeholder show the REAL Sprout default for this
  // token (in the mode being edited) rather than a generic grey, so an
  // untouched control still reads as the design-system colour it'll resolve to.
  const fallback = defaultColorHex(def.key, mode) ?? "#888888";
  const swatch = /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${def.label} colour picker`}
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          className="size-9 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent p-0.5"
        />
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultColorHex(def.key, mode) ?? "Sprout default"}
          spellCheck={false}
          autoCapitalize="none"
          className="font-mono text-xs"
        />
        {value && <ResetButton onClick={() => onChange("")} label={`Reset ${def.label}`} />}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {COLOR_PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={`Use ${c}`}
            title={c}
            className={cn(
              "size-5 rounded-full border border-border transition-transform hover:scale-110",
              value.toLowerCase() === c && "ring-2 ring-ring ring-offset-1 ring-offset-background",
            )}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

/** Length control: a px slider with a live readout — never a CSS length string. */
function LengthControl({
  def,
  value,
  onChange,
}: {
  def: ThemeTokenDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const s = def.slider ?? { min: 0, max: 48, step: 1, default: 0 };
  const px = parsePx(value);
  const isSet = value.trim().length > 0 && px !== null;
  // While unset, park the thumb at the Sprout default so the control reads true.
  const shown = px ?? s.default;
  return (
    <div className="flex items-center gap-3">
      <Slider
        aria-label={def.label}
        value={[shown]}
        min={s.min}
        max={s.max}
        step={s.step}
        onValueChange={(v) => onChange(`${Array.isArray(v) ? v[0] : v}px`)}
        className="min-w-0 flex-1"
      />
      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {isSet ? `${shown}px` : "Default"}
      </span>
      {isSet && <ResetButton onClick={() => onChange("")} label={`Reset ${def.label}`} />}
    </div>
  );
}

/** Font control: a Google Fonts dropdown, each option previewed in its own face. */
function FontControl({
  def,
  value,
  onChange,
}: {
  def: ThemeTokenDef;
  value: string;
  onChange: (value: string) => void;
}) {
  const trimmed = value.trim();
  const known = findGoogleFont(trimmed);
  // A non-empty value that isn't in the catalog (legacy/migrated) still shows.
  const isCustom = trimmed.length > 0 && !known;
  const current = trimmed.length === 0 ? FONT_DEFAULT : trimmed;
  return (
    <Select
      value={current}
      onValueChange={(v) => {
        if (!v) return;
        onChange(v === FONT_DEFAULT ? "" : v);
      }}
    >
      <SelectTrigger className="w-full" aria-label={def.label}>
        <SelectValue placeholder="Sprout default">
          {(val: string) => {
            if (!val || val === FONT_DEFAULT)
              return <span className="text-muted-foreground">Sprout default</span>;
            const f = findGoogleFont(val);
            return <span style={{ fontFamily: val }}>{f ? f.name : "Custom"}</span>;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-72">
        <SelectItem value={FONT_DEFAULT}>Sprout default</SelectItem>
        {GOOGLE_FONT_CATEGORIES.map((cat) => (
          <SelectGroup key={cat}>
            <SelectLabel>{cat}</SelectLabel>
            {GOOGLE_FONTS.filter((f) => f.category === cat).map((f) => (
              <SelectItem key={f.name} value={f.stack} style={{ fontFamily: f.stack }}>
                {f.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {isCustom && (
          <SelectItem value={trimmed} style={{ fontFamily: trimmed }}>
            Custom
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}

function TokenControl({
  def,
  value,
  mode,
  onChange,
}: {
  def: ThemeTokenDef;
  value: string;
  mode: ThemeMode;
  onChange: (value: string) => void;
}) {
  if (def.kind === "color")
    return <ColorControl def={def} value={value} mode={mode} onChange={onChange} />;
  if (def.kind === "length") return <LengthControl def={def} value={value} onChange={onChange} />;
  return <FontControl def={def} value={value} onChange={onChange} />;
}

/**
 * Load every catalog Google Font once so the font dropdown can preview each
 * family in its own face. The <link> is left in <head> on unmount (cheap, and it
 * keeps previews instant if the editor re-opens). Client-only.
 */
function useGoogleFontPreviews() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const href = googleFontsHref(ALL_GOOGLE_FAMILIES);
    if (!href) return;
    const id = "sprout-gfont-preview";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;
  }, []);
}

export function ThemeControls({
  theme,
  onChange,
  mode,
  className,
}: {
  theme: BrandTheme;
  onChange: (next: BrandTheme) => void;
  mode: ThemeMode;
  className?: string;
}) {
  useGoogleFontPreviews();
  const empty = isThemeEmpty(theme);
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Leave a control untouched to keep the Sprout default.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={empty}
          onClick={() => {
            if (empty) return;
            const ok =
              typeof window === "undefined" ||
              window.confirm(
                "Reset every colour, radius, spacing, and font back to the Sprout defaults? This clears the theme overrides in this editor (you can still discard by not saving).",
              );
            if (ok) onChange({});
          }}
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset to defaults
        </Button>
      </div>
      {GROUP_ORDER.map((group) => {
        const defs = THEME_TOKENS.filter((t) => t.group === group);
        if (defs.length === 0) return null;
        const isColorGroup = defs[0]!.scope === "mode";
        // Fonts get a full-width column (the dropdown is wide); everything else
        // pairs up two-across on wider screens.
        const oneColumn = defs[0]!.kind === "font";
        return (
          <fieldset key={group} className="flex flex-col gap-3">
            <legend className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {group}
              {isColorGroup ? ` · ${mode}` : ""}
            </legend>
            <div className={cn("grid gap-x-4 gap-y-3", !oneColumn && "sm:grid-cols-2")}>
              {defs.map((def) => (
                <div key={def.cssVar} className="flex min-w-0 flex-col gap-1.5">
                  <Label htmlFor={`token-${def.cssVar}`} className="text-xs">
                    {def.label}
                  </Label>
                  <TokenControl
                    def={def}
                    value={tokenValue(theme, def, mode)}
                    mode={mode}
                    onChange={(value) => onChange(setThemeToken(theme, def, mode, value))}
                  />
                </div>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
