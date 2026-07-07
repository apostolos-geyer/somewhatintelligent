# 11 — Tenant Theming & Live Portal Preview

> **Scope.** Replace the minimal three-colour brand-skin surface with a full
> per-tenant theming system over the design system — **all** semantic colour
> tokens, the **radius** scale, **spacing/density**, and **fonts** — and replace
> the dumbed-down editor mock with an **actual, interactive preview of the real
> portal** that a brand admin drives from a floating FAB ("demo mode"). Changes
> in demo mode are **browser-local** until explicitly saved/published, so they
> never reach other users.
>
> Builds on the runtime theming model from [04 — UI](./04-ui.md) (`BrandStyle`,
> `brandThemeToCss`, the `brand_theme` draft/live split) and the data model from
> [02 — Data Model](./02-data-model.md) (`brand_theme.{draft,live}_theme_json`).
> Nothing in the portal **layout** changes — only which design tokens a tenant
> can override and how they preview them.

---

## 0. Why

Today a brand can override exactly three things — `--color-sprout` (primary),
a (functionally inert) `--color-accent`, `--color-background`, plus two fonts —
and previews them in a hand-built mock card (`PortalSetupForm`'s `previewVars`).
That is nowhere near enough to reproduce a real brand look (e.g. the MTL
dark-first, lime-on-black, sharp-cornered mockup): rounding, surfaces, text
colours, borders, status accents, and density are all locked to Sprout defaults,
and the mock preview doesn't resemble the portal the budtender actually sees.

This doc specifies a system where a tenant can drive the whole design-system
token surface and **see it on the real portal, live**, before publishing.

---

## 1. The one hard constraint: `@theme inline`

`packages/design` generates its Tailwind v4 theme as a single `@theme inline`
block (`generated/css/tailwind-theme.css`, from `scripts/codegen.ts`). In
Tailwind v4 the `inline` keyword changes what a utility compiles to:

| Codegen emits                                                 | Utility compiles to           | Runtime-overridable via `:root { --x }`? |
| ------------------------------------------------------------- | ----------------------------- | ---------------------------------------- |
| `--color-sprout: var(--color-sprout)` (alias to `tokens.css`) | `var(--color-sprout)`         | **Yes**                                  |
| `--radius-sm: 10px` (literal)                                 | `border-radius: 10px` (baked) | **No**                                   |

So **colours, fonts, and shadows are already runtime-overridable** (their `@theme
inline` right-hand side is a `var(--…)` pointing at a plain custom property in
`tokens.css`). That is exactly why the current brand skin works — it redefines
`--color-sprout` in an injected `:root` block.

**Radius and spacing are not overridable** — they are inlined literals, baked
into every `rounded-*` / `p-page` utility at build time. Redefining
`--radius-sm` at runtime does nothing.

### Fix (design-package codegen, value-identical)

Make radius + semantic spacing follow the same alias pattern colours already use:

1. `generateTokensCSS()` emits the raw values as plain custom properties in
   `:root` (theme-invariant — no dark variant): a new `/* Radius */` and
   `/* Semantic spacing */` block (`--radius-xs: 6px; … --spacing-page:
clamp(…); …`).
2. `generateTailwindTheme()` changes the radius + semantic-spacing entries in the
   `@theme inline` block from literals to `var(--radius-xs)` / `var(--spacing-page)`.

The **computed default output is byte-for-byte identical** — every utility holds
the same value; it now reads it through a variable instead of a baked literal. No
app's appearance changes; the tokens simply become overridable. The base Tailwind
spacing multiplier `--spacing` (driving `p-4`, `gap-2`, …) is already a core
Tailwind variable and is overridable today with no codegen change — it is the
brand "density" knob.

A codegen **invariant test** (see §7) snapshots the default radius/spacing values
to guard against accidental drift when this file changes.

> **Blast radius.** `@greenroom/design` is consumed by every app (identity, quiz,
> promoter, …). Because the change is value-identical and those apps inject no
> brand overrides, their rendering is unchanged. Verified by a workspace build +
> typecheck.

---

## 2. Token model (`BrandTheme` v2)

`brand_theme.{draft,live}_theme_json` already store the theme as opaque JSON, so
**no schema/migration is required** — only the JSON shape grows. The new shape:

```ts
type ThemeModePolicy = "adaptive" | "fixed";

interface BrandTheme {
  // Appearance strategy:
  //  "adaptive" (default) → light + dark palettes; respects the user/system mode
  //  "fixed"             → ONE palette, portal appearance pinned to `fixedMode`
  modePolicy?: ThemeModePolicy;
  fixedMode?: "light" | "dark"; // only meaningful when policy === "fixed"

  // Colour overrides, per mode. Keys ∈ COLOR token allow-list (§3).
  light?: Partial<Record<ColorTokenKey, string>>;
  dark?: Partial<Record<ColorTokenKey, string>>;

  // Mode-invariant tokens.
  radius?: Partial<Record<RadiusKey, string>>; // xs sm md lg xl full
  spacing?: Partial<Record<SpacingKey, string>>; // base page section grid
  fonts?: Partial<Record<FontKey, string>>; // display body mono accent
}
```

**Adaptive vs fixed** is the answer to "light & dark vs fixed colours": a brand
either authors both palettes (and the portal keeps its light/dark toggle), or
authors one palette and pins the look (MTL → `fixed` + `dark`). See §5 for how
`fixed` is rendered.

**Backwards compatibility.** `parseBrandTheme` detects the old shape
(`{ colors: { primary, … }, font: { … } }`) and migrates: `primary → light.sprout

- dark.sprout`, `background → light.bg`, `font._ → fonts._`. The old (inert)
`accent` is dropped. Migration is best-effort and lossless for everything that
  actually rendered.

---

## 3. Token registry — single source of truth

`workers/sprout/src/lib/theme-tokens.ts` enumerates every overridable token once.
Each entry: `{ key, cssVar, label, group, kind, scope, default }` where

- `group`: `"Surfaces" | "Text" | "Accents" | "Radius" | "Spacing" | "Fonts"`
- `kind`: `"color" | "length" | "font"` (drives the editor control)
- `scope`: `"mode"` (colour, lives under `light`/`dark`) or `"global"`
  (radius/spacing/fonts)
- `default`: the Sprout default(s), shown as the control's placeholder/reset

Everything else derives from this list: the CSS generator (§4), the editor and
the FAB controls (§6), and the server-side **allow-list** (§4). Adding a token =
one registry entry.

**Colour tokens exposed** (the full semantic palette — every shadcn alias maps
onto these, so this _is_ "all colour tokens"):

- Surfaces: `bg`, `surface`, `surface-raised`, `surface-sunken`, `border`,
  `border-strong`
- Text: `text`, `text-secondary`, `text-tertiary`, `text-on-accent`
- Accents: `sprout` (+`-hover`), `stigma` (+`-hover`), `growth` (+`-hover`),
  `pistil` (+`-hover`), `haze` (+`-hover`)

**Radius:** `xs sm md lg xl full` · **Spacing:** `base page section grid` ·
**Fonts:** `display body mono accent`.

---

## 4. CSS generation (one function, three callers)

`themeToCssVars(theme): string` is the single mapping from a `BrandTheme` to the
text of a `<style>` body. It is used by **(a)** SSR `BrandStyle` (persisted live
theme), **(b)** the demo-mode preview controller (draft + local edits), and a
sibling `themeToStyleObject` for any scoped inline-style needs.

Output shape:

```css
:root{ <light colours>; <radius>; <spacing>; <fonts> }
[data-theme="dark"]{ <dark colours> }
```

Rules:

- **Global tokens** (radius/spacing/fonts) always go in `:root` (theme-invariant).
- **Adaptive:** `light.*` → `:root`, `dark.*` → `[data-theme="dark"]`.
- **Fixed:** the chosen palette is emitted into **both** `:root` and
  `[data-theme="dark"]` (identical), so the portal renders the same regardless of
  the active mode; the portal additionally **pins** `data-theme` to `fixedMode`
  and hides the mode toggle (§5).
- Only keys present in the registry allow-list are emitted; unknown keys are
  dropped. Every value passes `sanitizeCssValue` (§8).

`parseBrandTheme` (safe JSON → `BrandTheme`, never throws) and the allow-list
both reference the registry, so the parser, the generator, and the server
validator can never disagree about which keys are legal.

---

## 5. Rendering `fixed` mode (pinning appearance)

For `modePolicy === "fixed"`:

- `themeToCssVars` writes the single palette into both selectors (above), so no
  mode flip can reveal an un-themed palette.
- `__root.tsx` SSR sets `data-theme={fixedMode}` on `<html>` for a fixed-brand
  host (so native form controls + `color-scheme` match), and the inline theme-init
  script respects a "pinned" flag instead of `localStorage`.
- The portal's dark-mode toggle is hidden for fixed brands.

This is the minimum needed for "fixed colours" to be airtight in both SSR and
client modes; the exact CSS specificity vs the `prefers-color-scheme` fallback in
`tokens.css` is verified in the browser during implementation (§7).

---

## 6. The two editing surfaces (shared controls)

A single presentational component, `<ThemeControls>`, renders inputs from the
registry (color picker for `kind:"color"`, length/slider for `"length"`,
text for `"font"`), grouped by `group`, with a light/dark sub-toggle shown only
when `modePolicy === "adaptive"`. Both surfaces below embed it, so there is **one**
control implementation.

### 6a. Settings editor — `/admin/setup` (`PortalSetupForm`)

The structured, full editor. Cards: Identity → **Appearance** (mode policy +
fixed-mode select) → **Colours** → **Rounding** → **Spacing** → **Fonts** →
Hero slides → Sections → Publish. Saves the draft via the (expanded)
`updateThemeDraft`. Gains a prominent **"Open live demo"** button (→ §6b).
The old hand-built mock preview is removed — the real preview is demo mode.

### 6b. Demo mode — FAB on the real portal

The "actual preview." A global `PreviewController` (mounted in the portal shell)
activates when the URL carries `?demo=1` **and** the caller is a brand admin
(role from context). When active it:

1. Fetches the admin's **draft** theme once (`getAdminTheme`, gated) and
   seeds editable local state (optionally persisted to `localStorage` keyed by
   `orgId`, so a refresh keeps in-progress work).
2. Renders the **real portal underneath**, untouched and fully interactive.
3. Injects/updates a `<style id="sprout-demo-theme">` in `<head>` with
   `themeToCssVars(localTheme)` — overriding `:root`/`[data-theme]` for **this
   browser only**, updated on every edit (instant).
4. Renders the **FAB**: a floating button that expands into a compact
   `<ThemeControls>` panel plus a mode preview toggle and actions — **Save draft**,
   **Publish** (flip), **Reset**, **Exit**. The FAB chrome re-asserts default
   Sprout tokens on itself so it stays legible even under an extreme in-progress
   theme.

**Isolation invariant.** Demo mode performs **no writes**. It only injects a
client-side `<style>` and mutates React state. Other users/sessions are never
affected. Persistence happens solely through the existing gated server fns when
the admin clicks Save (`updateThemeDraft`) or Publish (`publishTheme`).

Non-admins who hit `?demo=1` get nothing (no FAB, no override); the server fns
remain the real security boundary regardless of the client gate.

---

## 7. Server & persistence

- `brand_theme` columns unchanged; richer JSON only.
- `updateThemeDraftInput` (arktype) expands to accept the v2 `theme` object.
  The handler **projects onto the registry allow-list** (drops unknown keys),
  **sanitizes every value** (§8), then writes `draftThemeJson`. `brand_id` stays
  the envelope's `activeOrgId`, never input. Brand-admin gated; audited — all
  unchanged from today.
- `publishTheme` unchanged (atomic draft→live JSON copy).
- `getAdminTheme` returns draft+live via `parseBrandTheme` (handles v2 +
  migrates v1).
- `getBrandForHost` (public) returns the **live** theme → `BrandStyle` SSR.

---

## 8. Security

- `sanitizeCssValue` is the boundary for values injected via
  `dangerouslySetInnerHTML`. Extended to permit quotes (`' "`) so multi-word font
  families work (e.g. `"Bebas Neue", sans-serif`), while still forbidding the
  characters that could break out of a declaration or the `<style>` element:
  `; { } < > :` (and anything outside the safe set). `url(...)` stays impossible
  (no `:` / unescaped chars), so no external fetch can be smuggled in.
- Keys are an allow-list (registry); values are length-bounded (arktype) and
  sanitized server-side regardless of client validation.
- Demo mode is client-only; it cannot persist or affect anyone else.

---

## 9. Testing requirements

Aligned to the three tiers in [06 — Testing Strategy](./06-testing-strategy.md)
(`bun run test` · `test:pool` · `test:e2e`).

1. **Unit (pure, like `brand.test.ts`):**
   - `themeToCssVars`: adaptive emits light→`:root` / dark→`[data-theme="dark"]`;
     fixed duplicates the palette into both selectors; radius/spacing/fonts land
     in `:root`; unknown keys dropped; sanitization strips `; { } < > :`.
   - `parseBrandTheme`: v1→v2 migration; malformed JSON → `{}`; non-string values
     dropped.
   - Registry/allow-list: every registry `cssVar` is unique; allow-list ===
     registry keys.
2. **Server (pool / D1):** `updateThemeDraft` accepts a v2 theme, strips
   non-allow-listed keys, sanitizes, round-trips through `getAdminTheme`;
   `publishTheme` copies draft→live.
3. **Codegen invariant:** snapshot default radius + spacing values; fails if a
   future codegen edit changes a computed default.
4. **Compliance/tenancy (existing suites):** demo-mode preview path performs no
   mutation; Save/Publish remain `decideBrandAdmin`-gated with `brand_id` from the
   envelope.
5. **E2E / browser (manual, agent-browser — not in CI per doc 06):** load the
   portal at `?demo=1` as an admin, change a colour + radius via the FAB, assert
   the **real** portal retints live; confirm a second session is unaffected
   (isolation); Save → Publish → live host reflects the change.

---

## 10. Build order

1. Design-package codegen alias (radius/spacing) + regenerate + invariant test +
   workspace build/typecheck. _(value-identical foundation)_
2. Token registry + `BrandTheme` v2 types + `parseBrandTheme` migration +
   `themeToCssVars` + sanitizer. Unit tests. Point `BrandStyle` at the new
   generator.
3. Server validator expansion + tests.
4. `<ThemeControls>` (registry-driven) → expand `PortalSetupForm`.
5. `PreviewController` + FAB demo mode + "Open live demo" entry.
6. Browser verification (agent-browser) + docs cross-links.

Each step is independently shippable; defaults are unchanged until a brand
authors tokens, so the portal is never broken mid-build.
