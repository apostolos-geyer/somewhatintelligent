# somewhatintelligent Design System — "DRAFT"

**The UI is a technical drawing.** Warm drafting paper, graphite ink,
ruled lines, generous rounding. Nothing glows, nothing blurs, nothing
floats on a soft shadow — depth is _drawn_, with border treatment and
hard-offset drafted lines, the way a blueprint communicates structure.

This document is the contract. Every component in `@si/ui`, every app
surface, and every future agent run is held to it.

---

## 1. The five rules

1. **Monochrome ink on paper.** One warm graphite ramp on warm drafting
   paper (inverted for dark mode). The only functional colors: **rust**
   (`--color-rust`) for destructive/danger — the red pen — and a muted
   **approval green** (`--color-success`) for positive outcomes. Process
   states (warning, info) stay ink-gray and are carried by border style.
2. **No soft shadows. No blur. Ever.** `box-shadow` blur radii are 0
   everywhere (the generated `--soft-*`/`--neo-*` variables resolve to
   hard lines), `backdrop-filter` does not exist, and the legacy `glass`
   utility renders an opaque sheet with a solid rule.
3. **Depth is border treatment.**
   | Treatment | Meaning |
   |---|---|
   | `border-solid` (+ `border-border-strong`, 1.5–2px) | primary surface, strongest emphasis, success/confirmed |
   | `border-dashed` | secondary surface, interactive affordance, warning/pending — **Card's default resting state**, not just a named variant, so the negative space of the page reads as visibly drawn |
   | `border-dotted` | tertiary, hints, dividers, informational |
   | `shadow-brutal-*` | a hard ink offset — the drafted "duplicate line" that stands a card/CTA off the paper |
   Solid is reserved for what actually needs the loudest read — data tables,
   destructive/danger states, floating overlays (dialog/sheet/drawer/popover)
   — not the default resting state of an ordinary content card.
4. **Sharp sections, soft controls.** Containers (cards, sheets, dialogs,
   menus, tables, popovers) are unrounded (`md`/`lg` = 0) — borders are the
   only structure signal there, square corners like a ruled drawing. Small
   interactive controls (buttons, badges, avatars, inputs, checkboxes,
   switches, radios) keep the pill/soft radius (`sm`=10px is the control
   default, `full` for pills).
5. **Iosevka is the voice.** `Iosevka Aile` for display/body/editorial,
   `Iosevka` (mono) for code, IDs, timestamps, and uppercase annotation
   labels — the "dimension text" of the drawing. No other typefaces are
   vendored or permitted.

## 2. Palette

Semantic tokens (theme-aware, from `src/tokens/colors.ts` → codegen):

| Token                                       | Light                                     | Dark                           | Use                                   |
| ------------------------------------------- | ----------------------------------------- | ------------------------------ | ------------------------------------- |
| `--color-bg`                                | drafting paper `hsl(45 33% 96%)`          | graphite board `hsl(45 7% 8%)` | page                                  |
| `--color-surface` / `-raised` / `-sunken`   | white sheet / fresh sheet / recessed well | lifted graphite steps          | containers                            |
| `--color-border`                            | `hsl(45 6% 52%)` (3.4:1)                  | `hsl(45 5% 40%)`               | the standard rule                     |
| `--color-border-strong`                     | `hsl(45 8% 30%)`                          | `hsl(45 7% 58%)`               | heavy rule, inputs                    |
| `--color-text` / `-secondary` / `-tertiary` | ink / annotation / faint pencil           | chalk equivalents              | type                                  |
| `--color-ink` (+`-hover`)                   | near-black                                | chalk-white                    | PRIMARY accent: buttons, links, focus |
| `--color-rust` (+`-hover`)                  | `hsl(14 55% 38%)`                         | brightened                     | destructive ONLY                      |
| `--color-success` (+`-hover`)               | approval green `hsl(140 32% 27%)`         | brightened                     | positive outcomes, solid border       |
| `--color-warning` (+`-hover`)               | ink-600 gray                              | chalk                          | pending/attention, DASHED border      |
| `--color-info` (+`-hover`)                  | ink-500 gray                              | chalk                          | informational, DOTTED border          |

Raw theme-invariant ramps for illustration/OG surfaces: `--color-ink-950…200`,
`--color-paper-0…300`, and `--color-status-*` pairings. Never use raw steps
for product UI chrome — semantic tokens only.

Contrast is enforced: `bun run audit:contrast` in `packages/design` must
report zero WCAG-AA failures (run automatically by `bun run build`).

## 3. Shadows are lines

The four generated shadow families survive by name, hard-edged by value:

- `shadow-brutal-sm|md|lg` — `Xpx Ypx 0 var(--color-border-strong)`. THE
  elevation effect. Interactive form: offset grows on hover, collapses on
  press (`interactiveMaterials.brutal` — the element sits down on the paper).
- `shadow-soft-*` — legacy name; now a single hard 0-blur rule. Prefer
  borders in new code.
- `shadow-neo-*` — hard 0-blur chisel for toggle-like controls.
- `glass` utility / `--glass-*` — legacy name; opaque sheet + solid rule.
- `--shadow-brand` — alias of `--brutal-md`. There is no glow.

## 4. Material language (`@si/ui/lib/materials`)

`surfaceMaterials` / `interactiveMaterials` / `compactMaterials` encode the
grammar once; components compose them. Key mapping: `brutal` = solid rule +
drafted offset (signature, reserved for tables/emphasis), `soft` = dashed
rule (quiet secondary; dashes commit to solid on hover) — **`Card`'s
`default` variant is `surfaceMaterials.soft`**, so dashed is what a plain
card looks like unless a component deliberately reaches for `brutal`, `neo` = chisel, `glass` = opaque sheet.

## 5. Component conventions

- **Buttons**: full pill. `default`/`strong` = solid ink fill (strong adds
  the drafted offset); `outline` = 1.5px heavy rule; `link` = dotted
  underline that commits to solid on hover; `destructive` = rust. Focus is
  a 2px solid ink ring, offset — a drafted focus rectangle, never a glow.
- **Badges**: status stamps carry state by border style — `soft` (success,
  solid green rule), `warn` (dashed), `info` (dotted), `danger` (solid
  rust), `contrast` (graphite fill). Accent fills: `ink|rust|success|warning`
  (+`-brutal`, `-glass` compounds).
- **Alerts**: same grammar — success solid, warning dashed, info dotted,
  destructive rust.
- **Overlays** (dialog/sheet/drawer): opaque sheet + rule + hard offset;
  scrim is plain translucent black (`bg-black/20`), never blurred.
- **Tooltips**: solid ink chip, paper text.
- **The mark**: a drafting registration mark (circle, cardinal ticks,
  plotted center) — single hook-free SVG in
  `packages/ui/src/components/ui/logo/logo-icon.tsx`, satori-safe, used by
  app and OG images alike. Wordmark: lowercase `somewhatintelligent` in
  Aile Light.

## 6. Do / Don't

- DO communicate hierarchy with ink weight (border width + lightness step)
  before reaching for a new token.
- DO use `type-mono-label` (uppercase Iosevka, tracked) for metadata — it
  reads as a dimension annotation.
- DON'T add `box-shadow` with a blur radius, `backdrop-filter`, gradients,
  or translucency on content surfaces. If a diff introduces one, it's wrong.
- DON'T add chromatic accents. New states must map onto the border grammar.
  (Exception already spent: rust for danger, green for success.)
- DON'T reference raw `--color-ink-*`/`--color-paper-*` steps in product UI.
- DON'T reintroduce typefaces. Iosevka Aile + Iosevka only.

## 7. Editing the system

Tokens live in `packages/design/src/tokens/*` (TS source of truth) →
`bun run codegen` regenerates `generated/css/*` → `bun run audit:contrast`
gates. Never hand-edit `generated/css`. After token changes, run
`bun run build` in `packages/design` and commit the regenerated CSS.
