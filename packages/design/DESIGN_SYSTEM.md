# Sprout Design System

---

# Part I: Philosophy & Identity

## Design Principles

**Light-first.** The system is designed on paper and adapted to the dark. Light
mode is the brand's primary identity — warm cream paper, forest-green ink. Every
color, surface, and shadow was born on the cream page. Dark mode is the forest
canvas: a deep indica green-black with cream text. Both modes are hand-authored
first-class themes, not derivations of one another.

**Rooted in nature, designed for connection.** The aesthetic language grows from
the cannabis plant and the Canadian outdoors — fresh sprout-green shoots, amber
pistils, terracotta stigma, the calm of a forest at dusk. Sprout is a
budtender-engagement platform for Canadian licensed producers and retailers:
learn green, earn green. The interface should feel warm, natural, and friendly —
something you want to spend time in, not something that intimidates you.

**Material honesty, softened.** Every visual treatment still maps to a physical
metaphor — paper lifts, glass blurs, surfaces press in when you touch them — but
the feel is gentle. Elevation comes from soft, diffused shadows, not hard offsets.
Corners are generously rounded. Nothing is sharp, brutal, or cold.

**Generous, not loud.** Headlines are confident and can be large, but the system
favors warmth over shouting. Display type scales fluidly from comfortable mobile
sizes up to big hero moments; it never feels cramped, and it never feels like it's
yelling. Whitespace, soft rounding, and warm color do the work that hard edges
used to.

---

## The Material Languages

The default material is **Soft** — gently elevated, generously rounded paper. The
other materials (Glass, Neumorphic, and the optional hard-edged "Pressed" accent)
exist for specific jobs, but when in doubt, reach for Soft.

### Soft (the default)

The signature. Warm paper that lifts gently off the page. Diffused multi-layer
shadows, a hairline forest border, friendly 10px corners.

**Visual language:**

- `border border-border`
- `shadow-soft-*` (diffused, multi-layer blur)
- `bg-card` / `bg-surface-raised`
- `rounded-sm` (10px) or larger for big surfaces

**When to use:** The default for nearly all UI surfaces and actions. Cards,
buttons, inputs, alerts, containers. If you do not know which material to use,
use this one.

**Active state:** Shadow shrinks to `shadow-soft-sm`, the surface presses in via
the `press-in` utility (scale 0.97). A gentle physical acknowledgment — not a
slam.

**Do:**

- Use for primary CTAs, form controls, content cards, containers
- Use the `shadow-soft-sm/md/lg` progression for hierarchy (lg at rest for cards,
  lg on hover for buttons, sm when pressed)

**Don't:**

- Use hard pixel-offset shadows for everyday surfaces — reserve those for the
  expressive Pressed accent
- Mix soft shadows and hard offset shadows on the same surface

---

### Glass

Frosted translucent surfaces. For anything that floats above other content and
needs to show depth through transparency.

**Visual language:**

- `glass` utility (translucent bg, 1px ring border, 24px backdrop blur, soft drop
  shadow)
- `rounded-sm` (10px) or larger
- No opaque background — always translucent

**When to use:** Floating/overlay elements ONLY — dialogs, alert dialogs,
popovers, dropdown menus, tooltips. Anything that sits in a z-layer above page
content.

**Active state:** Shadow shrinks, `press-in` scale (for interactive glass
elements like buttons).

**Rule:** Glass elements MUST have content behind them to blur. Never use `glass`
on a flat background with nothing beneath it — the blur will show nothing and the
element will look broken. In light mode the glass is a frosted warm cream; in dark
mode it is a frosted forest with a sprout-tinted edge.

**Do:**

- Use for ALL overlay/floating components
- Layer over content-rich backgrounds for maximum effect

**Don't:**

- Use on inline/flow elements
- Inline glass styles manually — always use the `glass` utility
- Use on a page with a flat solid background and no content beneath

---

### Neumorphic

Carved from the surface itself. For elements that feel physical and toggle-like —
pushed in and out of the material. Soft and rounded, like a pebble pressed into
clay.

**Visual language:**

- `shadow-neo-raised` (highlight top-left, shadow bottom-right)
- `bg-surface`, no border
- No border — the shadow IS the edge

**When to use:** Toggle-like interactions, elements that feel raised or pressed.
Switch-like buttons, mode selectors.

**Active state:** Flips to `shadow-neo-inset` + `press-in` scale. The raised
surface caves in.

**Do:**

- Use for elements where on/off or raised/pressed is meaningful
- Always pair raised and inset states as a toggle pair

**Don't:**

- Use for cards that contain complex content
- Add borders — neumorphic edges come from light/shadow only
- Use on `bg` (page background) — needs the `surface` base to cast correctly

---

### Pressed (expressive accent)

The optional hard-edged treatment. A flat, pixel-offset shadow that gives a
playful, sticker-like pop. Use sparingly, for moments that want extra energy — a
hero CTA, a feature callout — never as the everyday default.

**Visual language:**

- `border-2 border-foreground` or `ring-1 ring-foreground`
- `shadow-brutal-*` (hard pixel offset, no blur)
- `rounded-sm` (10px) — still soft corners, even when the shadow is hard

**Active state:** Shadow disappears, the element slams into the surface —
`translate-x-1 translate-y-1 shadow-none`. The shadow offset becomes the
translation.

**Do:**

- Use for the occasional high-energy CTA or playful callout
- Keep the soft 10px radius even here — the corners stay friendly

**Don't:**

- Use it as the default material (Soft is the default)
- Apply to floating/overlay elements (use Glass)
- Mix hard offset shadows with soft shadows on the same surface

---

## Color Philosophy — Rooted in Nature

The color system is named after the cannabis plant. Each accent is not just a hue
— it is a part of the plant with meaning. Light mode is the brand's primary
identity: warm cream paper, deep forest-green ink. Dark mode is the forest canvas.

### Sprout — Brand Green

The primary accent. A fresh green shoot — the iconic sprout-lime that glows on the
forest canvas, and a deep, legible growth-green on cream paper.

**Meaning:** Interactive. Alive. Primary. Sprout is the color of things you can
touch, activate, or follow.
**Usage:** Links, CTAs, focus rings, active states, interactive highlights,
primary badges, chart-1.

### Stigma — Terracotta

The destructive accent. Warm, earthy, bold — the terracotta clay of the plant's
stigma.

**Meaning:** Danger. Destruction. Caution-with-weight. Stigma is the color of
irreversible actions and critical states.
**Usage:** Delete actions, errors, critical alerts, destructive buttons,
destructive badges, chart-2.

### Growth — Growth Green

Utility accent. A grounded, functional green — the color of a healthy, growing
plant.

**Meaning:** Confirmation. Growth. Stability. Growth is the color of things that
succeeded or are healthy.
**Usage:** Success confirmations, published/active status, positive deltas,
checkmarks, chart-3.

### Pistil — Amber

Utility accent. The warm amber of the cannabis pistil — energetic and optimistic.

**Meaning:** Attention. Caution. Pending. Pistil is the color of things that need
your awareness but not alarm.
**Usage:** Warnings, pending states, attention-needed indicators, chart-4.

### Haze — Purple

Utility accent. The mystical, premium purple haze of the plant — calm and
distinctive.

**Meaning:** Information. Secondary. Neutral. Haze is the color of metadata and
things that inform without demanding.
**Usage:** Info badges, secondary actions, metadata emphasis, neutral status,
chart-5.

**Light vs dark behavior.** Light-mode accents are DEEP (so legible cream text
reads on their fills). Dark-mode accents BRIGHTEN (so dark indica text reads, and
they glow on the forest canvas). This mirrors how the brand uses a deep functional
green for actions and the bright sprout-lime as a hero glow.

---

## Typography Philosophy

### Five Font Families

| Role      | Token                           | Font           | Why                                                                                                                |
| --------- | ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Display   | `font-display` / `font-heading` | Zerove         | Friendly, rounded, unicase display. Headlines, hero, page titles, stat numbers. Renders effectively all-caps.      |
| Body      | `font-body` / `font-sans`       | Switzer        | The workhorse. Variable grotesque sans. Every piece of UI chrome, every label, every button (weights 100–900).     |
| Editorial | `font-editorial`                | IBM Plex Serif | Long-form reading. Light upright serif for sustained prose — articles, blog posts, email body. Never in UI chrome. |
| Accent    | `font-accent`                   | Quadrillion    | Supporting accent face for taglines and playful marks ("learn green, earn green"). Decorative, not for body or UI. |
| Mono      | `font-mono`                     | Iosevka        | Data. Code. Timestamps. IDs. Paths. Keys. Technical metadata. Never for prose or UI labels.                        |

Editorial headings (`font-editorial-display`) reuse **Zerove** inside prose for
h1–h4.

### The Display Principle

Display type uses `clamp()` to scale fluidly from mobile to ultrawide. Zerove is
warm and rounded, so big sizes feel friendly rather than aggressive:

- Hero text: 80px to 200px
- Page titles: 32px to 56px
- Stat numbers: 28px to 48px
- Display titles: 24px to 36px

Use the fluid scale for display moments and let the viewport decide. Keep Zerove
at display sizes (it renders unicase and shines large); never set it tiny.

---

## The Radius Manifesto

**Soft corners, by default.**

Sprout is friendly. Generous rounding mirrors the rounded geometry of the Sprout
logo and the brand's "designed for connection" warmth. The default is a soft 10px,
and the scale goes up from there for bigger surfaces.

- `rounded-sm` (10px) — THE default. Buttons, inputs, badges, small cards. When in
  doubt, this is the radius.
- `rounded-xs` (6px) — tight rounding for chips, tiny controls, inline tags.
- `rounded-md` (16px) — cards, sheets, menus.
- `rounded-lg` (22px) — large cards, media frames.
- `rounded-xl` (30px) — hero panels, feature backdrops, big CTA blocks.
- `rounded-full` (9999px) — pills, avatars, toggles, segmented controls, fully
  round chips.
- `rounded-none` (0px) — full-bleed edges only.

Bigger surfaces deserve bigger radii — a hero panel at `rounded-xl` (30px) feels
calm and intentional, while a chip at `rounded-xs` (6px) stays crisp. Avatars and
toggles are round (`rounded-full`); circles are not just allowed, they are part of
the friendly vocabulary. Radius is a warmth lever — use it generously.

---

## Shadow Philosophy

Three shadow families. Each has a material meaning. Never mix them on the same
surface.

### Soft — Diffused Elevation (the default)

Warmth. Lift. Approachability. Multi-layer blurred shadows with low opacity. The
shadow of warm paper floating gently above the page. This is the everyday
elevation for cards, buttons, and containers.

### Neumorphic — Raised/Inset

Interactive. Physical. Toggle-like. Dual-direction shadows (highlight + shadow)
that simulate depth pressed into a surface. The shadow of a pebble pressed into
soft clay.

### Brutal — Hard Offset (expressive accent)

Energy. Playful pop. Zero blur, pure pixel offset. The sticker-like shadow of the
optional Pressed treatment — used sparingly for high-energy moments, never as the
default.

**Plus Glass** — a subtle drop shadow that is part of the `glass` utility for
floating surfaces.

**Plus the brand glow** — `shadow-brand`, a soft sprout-green drop shadow
(`0 10px 28px hsl(115 52% 41% / 0.3)`) for hero CTAs that want to feel alive.

**The rule:** Soft = everyday lift. Neo = interactive. Brutal = expressive pop. A
surface belongs to one family. Mixing families is incoherent.

---

# Part II: Token Reference

## Complete Color Table

HSL values are written as `H S% L%` (the form the tokens emit). Hexes are
generated from these in `src/tokens/colors.ts`.

### Surface Colors

| Token                    | Light Mode    | Dark Mode     | Role                                             |
| ------------------------ | ------------- | ------------- | ------------------------------------------------ |
| `--color-bg`             | `60 23% 94%`  | `143 100% 7%` | Page background — cream paper / indica forest    |
| `--color-surface`        | `0 0% 100%`   | `146 82% 11%` | White card / forest-900 — sidebar, nav, neo base |
| `--color-surface-raised` | `60 33% 98%`  | `146 66% 16%` | Cards, inputs, elevated content                  |
| `--color-surface-sunken` | `140 22% 96%` | `146 100% 6%` | forest-50 well / carved well — code, inset rows  |
| `--color-border`         | `145 18% 50%` | `150 24% 40%` | Forest line — default borders (3:1 on canvas)    |
| `--color-border-strong`  | `150 22% 42%` | `150 18% 45%` | Deeper forest — input borders                    |

### Text Colors

| Token                    | Light Mode    | Dark Mode     | Role                                             |
| ------------------------ | ------------- | ------------- | ------------------------------------------------ |
| `--color-text`           | `143 100% 7%` | `60 23% 94%`  | Primary ink — indica forest green / cream        |
| `--color-text-secondary` | `150 34% 31%` | `140 16% 81%` | forest-600 / forest-300 — descriptions           |
| `--color-text-tertiary`  | `150 18% 45%` | `150 13% 60%` | forest-500 / forest-400 — metadata, placeholders |
| `--color-text-on-accent` | `60 23% 94%`  | `143 100% 7%` | Cream / indica — text ON colored accent fills    |

### Accent Colors

Each accent has a base and a `-hover`. Light fills are deep (cream text reads on
them); dark fills brighten (dark indica text reads, and they glow on forest).

| Token            | Light         | Light Hover   | Dark          | Dark Hover    | Role                         |
| ---------------- | ------------- | ------------- | ------------- | ------------- | ---------------------------- |
| `--color-sprout` | `122 55% 28%` | `123 58% 23%` | `80 81% 72%`  | `82 85% 80%`  | Primary accent — brand green |
| `--color-stigma` | `17 56% 40%`  | `16 60% 33%`  | `14 60% 62%`  | `13 64% 70%`  | Destructive — terracotta     |
| `--color-growth` | `116 56% 29%` | `117 60% 24%` | `100 58% 64%` | `98 62% 72%`  | Success — growth green       |
| `--color-pistil` | `38 70% 34%`  | `37 74% 28%`  | `40 95% 56%`  | `40 98% 64%`  | Warning — amber              |
| `--color-haze`   | `283 34% 37%` | `283 38% 30%` | `279 38% 72%` | `279 42% 80%` | Info — purple haze           |

### Effect Colors

| Token            | Light Mode               | Dark Mode                 |
| ---------------- | ------------------------ | ------------------------- |
| `--glass-bg`     | `hsl(60 23% 96% / 0.72)` | `hsl(146 82% 11% / 0.55)` |
| `--glass-border` | `hsl(0 0% 100% / 0.6)`   | `hsl(80 81% 72% / 0.16)`  |
| `--glass-blur`   | `24px`                   | `24px`                    |

### Raw Brand Palette

For marketing/decorative visuals only, `brandPalette` (in
`src/tokens/colors.ts`) exposes literal brand hexes: `sproutGreen` (#C7F27D),
`growthGreen` (#3E9F32), `sativaGreen` (#B2DF93), `indicaGreen` (#00240D),
`purpleHaze` (#6D4C7D), `plumKush` (#2E233F), `lilacDiesel` (#AE92C3), `pistil`
(#F4A300), `stigma` (#B85C38), `trichome` (#D7ADAD), `cream` (#F2F2EC). In
product/component code, always use the semantic tokens — never a raw hex.

---

## Complete Color Pairing Guide

### Surface Pairings — Text on Backgrounds

| Foreground       | Background       | Tailwind Classes                      | When to Use                    | WCAG              |
| ---------------- | ---------------- | ------------------------------------- | ------------------------------ | ----------------- |
| `text`           | `bg`             | `text-foreground bg-background`       | Page-level body text           | AAA               |
| `text`           | `surface`        | `text-foreground bg-surface`          | Sidebar text, nav items        | AAA               |
| `text`           | `surface-raised` | `text-foreground bg-card`             | Card body text                 | AAA               |
| `text`           | `surface-sunken` | `text-foreground bg-muted`            | Code block text, inset content | AAA               |
| `text-secondary` | `bg`             | `text-text-secondary bg-background`   | Descriptions on page           | AA                |
| `text-secondary` | `surface`        | `text-text-secondary bg-surface`      | Sidebar descriptions           | AA                |
| `text-secondary` | `surface-raised` | `text-text-secondary bg-card`         | Card descriptions              | AA                |
| `text-secondary` | `surface-sunken` | `text-text-secondary bg-muted`        | Inset descriptions             | AA                |
| `text-tertiary`  | `bg`             | `text-muted-foreground bg-background` | Metadata, placeholders         | AA (3:1 non-text) |
| `text-tertiary`  | `surface`        | `text-muted-foreground bg-surface`    | Sidebar metadata               | AA (3:1 non-text) |

### Accent-on-Accent — `text-on-accent` on Accent Backgrounds (Badges, Buttons)

| Foreground       | Background | Tailwind Classes                    | When to Use                     | WCAG |
| ---------------- | ---------- | ----------------------------------- | ------------------------------- | ---- |
| `text-on-accent` | `sprout`   | `text-primary-foreground bg-sprout` | Primary badge, sprout badge     | AA   |
| `text-on-accent` | `stigma`   | `text-primary-foreground bg-stigma` | Destructive badge, stigma badge | AA   |
| `text-on-accent` | `growth`   | `text-primary-foreground bg-growth` | Growth badge                    | AA   |
| `text-on-accent` | `pistil`   | `text-primary-foreground bg-pistil` | Pistil badge                    | AA   |
| `text-on-accent` | `haze`     | `text-primary-foreground bg-haze`   | Haze badge                      | AA   |

### Tinted Backgrounds — Accent Text on Accent/10 Background (Alerts)

| Foreground | Background  | Tailwind Classes           | When to Use       | WCAG |
| ---------- | ----------- | -------------------------- | ----------------- | ---- |
| `stigma`   | `stigma/10` | `text-stigma bg-stigma/10` | Destructive alert | AA   |
| `sprout`   | `sprout/10` | `text-sprout bg-sprout/10` | Info/sprout alert | AA   |
| `growth`   | `growth/10` | `text-growth bg-growth/10` | Success alert     | AA   |
| `pistil`   | `pistil/10` | `text-pistil bg-pistil/10` | Warning alert     | AA   |

### Inverted — Tooltip Inversion

| Foreground   | Background      | Tailwind Classes                   | When to Use | WCAG |
| ------------ | --------------- | ---------------------------------- | ----------- | ---- |
| `background` | `foreground/90` | `text-background bg-foreground/90` | Tooltips    | AAA  |

### Glass — Text on Glass Surfaces

| Foreground | Background | Tailwind Classes                | When to Use                  | WCAG                      |
| ---------- | ---------- | ------------------------------- | ---------------------------- | ------------------------- |
| `text`     | glass      | `text-popover-foreground glass` | Dialogs, popovers, dropdowns | AA+ (depends on backdrop) |

### Accent Text on Surfaces — Inline Indicators

| Foreground | Background              | Tailwind Classes                   | When to Use                                    | WCAG     |
| ---------- | ----------------------- | ---------------------------------- | ---------------------------------------------- | -------- |
| `sprout`   | `bg` / `surface-raised` | `text-sprout`                      | Links, interactive highlights, accent emphasis | AA       |
| `growth`   | `bg` / `surface-raised` | `text-growth`                      | Positive deltas, checkmarks, success text      | AA       |
| `stigma`   | `bg` / `surface-raised` | `text-stigma` / `text-destructive` | Error text, critical inline status             | AA       |
| `pistil`   | `bg` / `surface-raised` | `text-pistil`                      | Warning text, pending inline status            | AA       |
| `haze`     | `bg` / `surface-raised` | `text-haze`                        | Neutral metadata emphasis                      | AA (3:1) |

---

## Type Scale

### Fixed Scale — UI Chrome

These override Tailwind's defaults with Sprout line-heights.

| Token       | Size             | Line-Height | Tailwind Class | Usage                                               |
| ----------- | ---------------- | ----------- | -------------- | --------------------------------------------------- |
| `text-2xs`  | 11px (0.6875rem) | 1.5         | `text-2xs`     | Mono labels, tiny metadata — system minimum         |
| `text-xs`   | 13px (0.8125rem) | 1.5         | `text-xs`      | Kbd, shortcut hints, tertiary metadata, badge text  |
| `text-sm`   | 15px (0.9375rem) | 1.5         | `text-sm`      | Body copy, descriptions, menu items, button default |
| `text-base` | 16px (1rem)      | 1.5         | `text-base`    | Default body, inputs, labels, accordion triggers    |
| `text-lg`   | 18px (1.125rem)  | 1.5         | `text-lg`      | Card compact titles, emphasized body                |
| `text-xl`   | 20px (1.25rem)   | 1.4         | `text-xl`      | Dialog/alert-dialog titles, section headings        |

### Fluid Scale — Display & Editorial

All use `clamp(min, preferred, max)` for smooth viewport scaling.

| Token           | Range               | Font                    | Weight | Leading | Tracking | Utility Class         | Usage                                              |
| --------------- | ------------------- | ----------------------- | ------ | ------- | -------- | --------------------- | -------------------------------------------------- |
| `hero`          | 80px - 14vw - 200px | Zerove                  | 400    | 0.95    | 0.005em  | `type-hero`           | Brand hero splash, landing page headline           |
| `pageTitle`     | 32px - 5vw - 56px   | Zerove                  | 400    | 1.0     | 0.005em  | `type-page-title`     | Main page heading — Dashboard, Settings            |
| `stat`          | 28px - 4vw - 48px   | Zerove                  | 400    | 1.0     | 0        | `type-stat`           | Dashboard stat numbers                             |
| `displayTitle`  | 24px - 3vw - 36px   | Zerove                  | 400    | 1.1     | 0        | `type-display-title`  | Card display heading, consent title, episode title |
| `editorialH1`   | 36px - 7vw - 72px   | Zerove                  | 400    | 1.0     | 0.005em  | `type-editorial-h1`   | Blog post / article h1                             |
| `editorialH2`   | 28px - 4vw - 42px   | Zerove                  | 400    | 1.1     | 0        | `type-editorial-h2`   | Blog post / article h2                             |
| `editorialH3`   | 22px - 3vw - 30px   | Zerove                  | 400    | 1.2     | 0        | `type-editorial-h3`   | Blog post / article h3                             |
| `editorialBody` | 16px - 2vw - 19px   | IBM Plex Serif          | 300    | 1.75    | 0        | `type-editorial-body` | Long-form article body text                        |
| `editorialLede` | 18px - 2.5vw - 22px | IBM Plex Serif (italic) | 300    | 1.7     | 0        | `type-editorial-lede` | Article opening paragraph                          |
| `pullquote`     | 24px - 4vw - 40px   | IBM Plex Serif (italic) | 300    | 1.32    | 0        | `type-pullquote`      | Pull quote in editorial content                    |

### Fixed Type Utilities

| Token          | Size | Font           | Weight | Leading | Tracking | Transform | Utility Class        | Usage                                            |
| -------------- | ---- | -------------- | ------ | ------- | -------- | --------- | -------------------- | ------------------------------------------------ |
| `monoLabel`    | 11px | Iosevka        | 400    | 1.0     | 0.06em   | uppercase | `type-mono-label`    | Timestamps, table headers, field labels          |
| `code`         | 14px | Iosevka        | 400    | 1.6     | 0        | —         | `type-code`          | Code blocks, inline code                         |
| `sectionLabel` | 15px | (body default) | 700    | 1.5     | 0.05em   | uppercase | `type-section-label` | Section headers, form dividers, category markers |

### Custom Leading

| Token            | Value | Tailwind Class           |
| ---------------- | ----- | ------------------------ |
| `display`        | 0.9   | `leading-display`        |
| `display-tight`  | 0.95  | `leading-display-tight`  |
| `heading`        | 1.1   | `leading-heading`        |
| `heading-loose`  | 1.2   | `leading-heading-loose`  |
| `pullquote`      | 1.3   | `leading-pullquote`      |
| `editorial-lede` | 1.7   | `leading-editorial-lede` |
| `editorial`      | 1.75  | `leading-editorial`      |

### Custom Tracking

| Token           | Value   | Tailwind Class           |
| --------------- | ------- | ------------------------ |
| `display`       | -0.03em | `tracking-display`       |
| `display-tight` | -0.02em | `tracking-display-tight` |
| `heading`       | -0.01em | `tracking-heading`       |
| `caps`          | 0.06em  | `tracking-caps`          |

---

## Complete Type Combination Guide

Every type combination actually used in components:

| Context             | Classes                                                            | Result                                            |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| CardTitle (default) | `font-heading text-2xl leading-snug font-medium`                   | Zerove 24px, snug leading, medium weight          |
| CardTitle (sm)      | `font-body text-lg leading-snug font-semibold`                     | Switzer 18px, snug leading, semibold              |
| DialogTitle         | `font-heading text-xl font-light leading-[1.1] tracking-[-0.01em]` | Zerove 20px, light weight, tight leading/tracking |
| AlertDialogTitle    | `font-heading text-xl font-light leading-[1.1] tracking-[-0.01em]` | Zerove 20px, light weight (same as DialogTitle)   |
| AlertTitle          | `font-semibold` (inherits text-sm from alert)                      | Body 15px, semibold                               |
| AccordionTrigger    | `text-base font-semibold`                                          | Body 16px, semibold                               |
| PopoverTitle        | `text-base font-medium`                                            | Body 16px, medium                                 |
| Badge               | `text-xs font-semibold`                                            | Body 13px, semibold                               |
| Button (default)    | `text-sm font-semibold`                                            | Body 15px, semibold                               |
| Button (xs/sm)      | `text-xs font-semibold`                                            | Body 13px, semibold                               |
| Button (lg)         | `text-base font-semibold`                                          | Body 16px, semibold                               |
| Button (xl)         | `text-lg font-semibold`                                            | Body 18px, semibold                               |
| Input               | `text-base`                                                        | Body 16px, regular                                |
| Tooltip             | `text-xs`                                                          | Body 13px, regular                                |
| DropdownMenuItem    | `text-sm`                                                          | Body 15px, regular                                |
| DropdownMenuLabel   | `text-xs font-medium`                                              | Body 13px, medium                                 |
| CardDescription     | `text-sm text-muted-foreground`                                    | Body 15px, tertiary color                         |
| DialogDescription   | `text-sm text-text-secondary`                                      | Body 15px, secondary color                        |
| Brand lockup        | `text-base font-semibold uppercase tracking-wider`                 | Body 16px, semibold, uppercase, wide tracking     |

---

## Shadow Tokens

### Soft Shadows (Diffused — the default)

Shadow color: `hsl(0 0% 0%)` (dark mode) / theme text color (light mode) —
multi-layer blur.

| Token     | Value                                | Tailwind Class   | Usage                                      |
| --------- | ------------------------------------ | ---------------- | ------------------------------------------ |
| `soft-sm` | `0 1px 3px /0.06, 0 1px 2px /0.04`   | `shadow-soft-sm` | Pressed state of soft elements             |
| `soft-md` | `0 4px 8px /0.08, 0 2px 4px /0.04`   | `shadow-soft-md` | Secondary buttons, glass elements, dialogs |
| `soft-lg` | `0 12px 24px /0.10, 0 4px 8px /0.05` | `shadow-soft-lg` | Cards at rest, hover uplift                |

### Neumorphic Shadows (Raised/Inset)

Dual-direction: highlight (top-left) + shadow (bottom-right).

| Token        | Light Mode Value                                                                | Tailwind Class      | Usage                                 |
| ------------ | ------------------------------------------------------------------------------- | ------------------- | ------------------------------------- |
| `neo-raised` | `4px 4px 8px hsl(60 90% 5%/0.08), -2px -2px 6px hsl(0 0% 100%/0.7)`             | `shadow-neo-raised` | Neo buttons/cards at rest             |
| `neo-inset`  | `inset 2px 2px 5px hsl(60 90% 5%/0.08), inset -2px -2px 5px hsl(0 0% 100%/0.6)` | `shadow-neo-inset`  | Neo buttons/cards when pressed/active |

| Token        | Dark Mode Value                                                               |
| ------------ | ----------------------------------------------------------------------------- |
| `neo-raised` | `6px 6px 14px hsl(0 0% 0%/0.5), -3px -3px 10px hsl(0 0% 100%/0.04)`           |
| `neo-inset`  | `inset 3px 3px 8px hsl(0 0% 0%/0.5), inset -3px -3px 8px hsl(0 0% 100%/0.03)` |

### Brutal Shadows (Hard Offset — expressive accent)

Shadow color: `var(--color-border-strong)` — no blur, pure offset. For the
optional Pressed treatment only.

| Token       | Value       | Tailwind Class     | Usage                            |
| ----------- | ----------- | ------------------ | -------------------------------- |
| `brutal-sm` | `2px 2px 0` | `shadow-brutal-sm` | Kbd, small expressive elements   |
| `brutal-md` | `4px 4px 0` | `shadow-brutal-md` | Pressed-treatment buttons        |
| `brutal-lg` | `6px 6px 0` | `shadow-brutal-lg` | Pressed-treatment cards/callouts |

### Glass Shadow & Brand Glow

| Token          | Value                                | Usage                                                   |
| -------------- | ------------------------------------ | ------------------------------------------------------- |
| `glass-shadow` | `0 4px 12px hsl(0 0% 0% / 0.15)`     | Drop shadow on glass surfaces (part of `glass` utility) |
| `shadow-brand` | `0 10px 28px hsl(115 52% 41% / 0.3)` | Soft sprout-green glow for hero CTAs (`shadow-brand`)   |

---

## Spacing Tokens

### Base

Tailwind's default `--spacing: 0.25rem` (4px) handles the entire numeric scale.
All spacing is multiples of 4px.

### Semantic Responsive Spacings

| Token     | Range                    | Tailwind Class              | Usage                                    |
| --------- | ------------------------ | --------------------------- | ---------------------------------------- |
| `page`    | `clamp(24px, 5vw, 48px)` | `p-page` / `px-page`        | Page-level horizontal + vertical padding |
| `section` | `clamp(24px, 4vw, 48px)` | `py-section` / `my-section` | Vertical space between major sections    |
| `grid`    | `clamp(12px, 2vw, 20px)` | `gap-grid`                  | Space between cards/items in grids       |

### Layout Widths

| Token     | Value                       | Tailwind Class  | Usage                               |
| --------- | --------------------------- | --------------- | ----------------------------------- |
| `prose`   | `clamp(320px, 75vw, 960px)` | `max-w-prose`   | Long-form article content max-width |
| `content` | `1100px`                    | `max-w-content` | Main content area max-width         |

### Component Spacing Reference

| Context               | Padding            | Gap              |
| --------------------- | ------------------ | ---------------- |
| Card (default)        | `py-4 px-4` (16px) | `gap-4` (16px)   |
| Card (sm)             | `py-3 px-3` (12px) | `gap-3` (12px)   |
| Dialog / Alert Dialog | `p-4` (16px)       | `gap-4` (16px)   |
| Popover               | `p-2.5` (10px)     | `gap-2.5` (10px) |
| Button (default)      | `h-9 px-4`         | `gap-1.5`        |
| Button (xs)           | `h-6 px-2`         | `gap-1`          |
| Button (sm)           | `h-7 px-3`         | `gap-1`          |
| Button (lg)           | `h-11 px-6`        | `gap-2`          |
| Button (xl)           | `h-14 px-8`        | `gap-2`          |
| Input                 | `h-10 px-3 py-2`   | —                |
| Alert                 | `px-3 py-2.5`      | `gap-0.5`        |
| Accordion item        | `py-3`             | —                |

---

## Radius Tokens

Soft and friendly. `sm` (10px) is THE default for nearly every component; larger
tokens are for bigger surfaces.

| Token  | Value    | Tailwind Class | Usage                                                     |
| ------ | -------- | -------------- | --------------------------------------------------------- |
| `none` | `0px`    | `rounded-none` | Full-bleed edges only                                     |
| `xs`   | `6px`    | `rounded-xs`   | Chips, tiny controls, inline tags                         |
| `sm`   | `10px`   | `rounded-sm`   | THE default. Buttons, inputs, badges, small cards.        |
| `md`   | `16px`   | `rounded-md`   | Cards, sheets, menus                                      |
| `lg`   | `22px`   | `rounded-lg`   | Large cards, media frames                                 |
| `xl`   | `30px`   | `rounded-xl`   | Hero panels, feature backdrops, big CTA blocks            |
| `full` | `9999px` | `rounded-full` | Pills — avatars, toggles, segmented controls, round chips |

(`--radius-2xl: 36px` also exists in `theme.css` to satisfy shadcn's internal
references.)

---

## Breakpoints

| Token | Value  | Tailwind Class |
| ----- | ------ | -------------- |
| `xxs` | 320px  | `xxs:`         |
| `xs`  | 475px  | `xs:`          |
| `sm`  | 640px  | `sm:`          |
| `md`  | 768px  | `md:`          |
| `lg`  | 1024px | `lg:`          |
| `xl`  | 1280px | `xl:`          |
| `2xl` | 1536px | `2xl:`         |
| `3xl` | 1792px | `3xl:`         |
| `4xl` | 2048px | `4xl:`         |
| `5xl` | 2304px | `5xl:`         |
| `6xl` | 2560px | `6xl:`         |
| `7xl` | 2816px | `7xl:`         |

**When to use what:**

- `clamp()` — Display type, page/section spacing (smooth fluid scaling)
- Breakpoints — Layout structure changes (sidebar collapse, grid columns, stacking)
- Fixed values — Component internal sizing (button height, input padding — never scales)

---

# Part III: Component Specs

## Button

| Property     | Value                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| Base classes | `inline-flex shrink-0 items-center justify-center text-sm font-semibold whitespace-nowrap transition-all rounded-sm` |
| Focus        | `focus-visible:ring-3 focus-visible:ring-ring/50`                                                                    |
| Disabled     | `disabled:pointer-events-none disabled:opacity-50`                                                                   |

### Button Variants

The everyday variants are Soft. The `pressed` variant is the optional expressive
hard-offset treatment.

| Variant       | Material   | Background       | Text                      | Border                       | Shadow              | Hover                               | Active                         |
| ------------- | ---------- | ---------------- | ------------------------- | ---------------------------- | ------------------- | ----------------------------------- | ------------------------------ |
| `default`     | Soft       | `bg-primary`     | `text-primary-foreground` | none                         | `shadow-soft-md`    | `shadow-soft-lg`, `bg-sprout-hover` | `shadow-soft-sm`, `press-in`   |
| `secondary`   | Soft       | `bg-card`        | `text-foreground`         | `border border-border`       | `shadow-soft-md`    | `shadow-soft-lg`                    | `shadow-soft-sm`, `press-in`   |
| `outline`     | —          | `bg-background`  | `text-foreground`         | `border border-input`        | none                | `bg-muted`                          | `bg-muted/80`, `press-in`      |
| `ghost`       | —          | transparent      | `text-foreground`         | none                         | none                | `bg-muted`                          | `bg-muted/80`, `press-in`      |
| `destructive` | Soft       | `bg-destructive` | `text-primary-foreground` | none                         | `shadow-soft-md`    | `shadow-soft-lg`, `bg-stigma-hover` | `shadow-soft-sm`, `press-in`   |
| `link`        | —          | transparent      | `text-primary`            | none                         | none                | underline                           | —                              |
| `neo`         | Neumorphic | `bg-secondary`   | `text-foreground`         | none                         | `shadow-neo-raised` | `shadow-neo-inset`                  | `shadow-neo-inset`, `press-in` |
| `glass`       | Glass      | `glass`          | `text-foreground`         | (glass ring)                 | `shadow-soft-md`    | `shadow-soft-lg`, brightness 110%   | `shadow-soft-sm`, `press-in`   |
| `success`     | Soft       | `bg-growth`      | `text-primary-foreground` | none                         | `shadow-soft-md`    | `shadow-soft-lg`                    | `shadow-soft-sm`, `press-in`   |
| `pressed`     | Pressed    | `bg-primary`     | `text-primary-foreground` | `border-2 border-foreground` | `shadow-brutal-md`  | `shadow-brutal-lg`, lift -0.5/-0.5  | `shadow-none`, slam +1/+1      |

### Button Sizes

| Size      | Height      | Padding | Gap     | Font Size        |
| --------- | ----------- | ------- | ------- | ---------------- |
| `default` | h-9 (36px)  | px-4    | gap-1.5 | text-sm (15px)   |
| `xs`      | h-6 (24px)  | px-2    | gap-1   | text-xs (13px)   |
| `sm`      | h-7 (28px)  | px-3    | gap-1   | text-xs (13px)   |
| `lg`      | h-11 (44px) | px-6    | gap-2   | text-base (16px) |
| `xl`      | h-14 (56px) | px-8    | gap-2   | text-lg (18px)   |
| `icon`    | 36x36       | —       | —       | —                |
| `icon-sm` | 28x28       | —       | —       | —                |
| `icon-lg` | 44x44       | —       | —       | —                |

---

## Badge

| Property     | Value                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Base classes | `inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-sm border border-transparent px-2.5 py-0.5 text-xs font-semibold` |

### Badge Variants

| Variant       | Background                | Text                        | Border          |
| ------------- | ------------------------- | --------------------------- | --------------- |
| `default`     | `bg-primary` (sprout)     | `text-primary-foreground`   | transparent     |
| `secondary`   | `bg-secondary` (surface)  | `text-secondary-foreground` | transparent     |
| `destructive` | `bg-destructive` (stigma) | `text-primary-foreground`   | transparent     |
| `outline`     | transparent               | `text-foreground`           | `border-border` |
| `sprout`      | `bg-sprout`               | `text-primary-foreground`   | `border-sprout` |
| `stigma`      | `bg-stigma`               | `text-primary-foreground`   | `border-stigma` |
| `growth`      | `bg-growth`               | `text-primary-foreground`   | `border-growth` |
| `pistil`      | `bg-pistil`               | `text-primary-foreground`   | `border-pistil` |
| `haze`        | `bg-haze`                 | `text-primary-foreground`   | `border-haze`   |

---

## Card

The default card is Soft — gently elevated warm paper with a hairline forest
border and friendly corners.

| Property     | Value                                                 |
| ------------ | ----------------------------------------------------- |
| Base classes | `flex flex-col gap-4 overflow-hidden py-4 rounded-md` |
| Size `sm`    | `gap-3 py-3`                                          |

### Card Variants

| Variant   | Material   | Background      | Border / Ring                | Shadow              |
| --------- | ---------- | --------------- | ---------------------------- | ------------------- |
| `default` | Soft       | `bg-card`       | `border border-border`       | `shadow-soft-lg`    |
| `neo`     | Neumorphic | `bg-surface`    | none                         | `shadow-neo-raised` |
| `glass`   | Glass      | (glass utility) | (glass ring)                 | (glass shadow)      |
| `pressed` | Pressed    | `bg-card`       | `border-2 border-foreground` | `shadow-brutal-lg`  |

### Card Subcomponents

| Subcomponent    | Key Classes                                                                              |
| --------------- | ---------------------------------------------------------------------------------------- |
| CardHeader      | `px-4` (sm: `px-3`), grid layout, auto-rows-min                                          |
| CardTitle       | `font-heading text-2xl leading-snug font-medium` (sm: `text-lg font-body font-semibold`) |
| CardDescription | `text-sm text-muted-foreground`                                                          |
| CardContent     | `px-4` (sm: `px-3`)                                                                      |
| CardFooter      | `border-t bg-muted/50 p-4` (sm: `p-3`)                                                   |

---

## Alert

| Property     | Value                                   |
| ------------ | --------------------------------------- |
| Base classes | `rounded-md border px-3 py-2.5 text-sm` |

### Alert Variants

| Variant       | Border                 | Background          | Text              | Description Color |
| ------------- | ---------------------- | ------------------- | ----------------- | ----------------- |
| `default`     | `border-border-strong` | `bg-surface-raised` | `text-foreground` | (inherited)       |
| `destructive` | `border-stigma`        | `bg-stigma/10`      | `text-stigma`     | `text-stigma/80`  |
| `sprout`      | `border-sprout`        | `bg-sprout/10`      | `text-sprout`     | `text-sprout/80`  |
| `growth`      | `border-growth`        | `bg-growth/10`      | `text-growth`     | `text-growth/80`  |
| `pistil`      | `border-pistil`        | `bg-pistil/10`      | `text-pistil`     | `text-pistil/80`  |

### Alert Subcomponents

| Subcomponent     | Key Classes                     |
| ---------------- | ------------------------------- |
| AlertTitle       | `font-semibold`                 |
| AlertDescription | `text-sm text-muted-foreground` |

---

## Dialog & Alert Dialog

| Property        | Dialog                                                             | Alert Dialog                                |
| --------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| Material        | Glass                                                              | Glass                                       |
| Content classes | `glass rounded-md p-4 gap-4 shadow-soft-md`                        | `glass rounded-md p-4 gap-4 shadow-soft-md` |
| Max width       | `sm:max-w-sm`                                                      | `sm:max-w-sm` (default), `max-w-xs` (sm)    |
| Title           | `font-heading text-xl font-light leading-[1.1] tracking-[-0.01em]` | Same                                        |
| Description     | `text-sm text-text-secondary`                                      | `text-sm text-balance text-text-secondary`  |
| Footer          | `-mx-4 -mb-4 border-t border-border/50 p-4`                        | Same                                        |
| Overlay         | `bg-black/10 backdrop-blur-xs`                                     | Same                                        |
| Animation       | `fade-in zoom-in-95` / `fade-out zoom-out-95`                      | Same                                        |

---

## Other Components

| Component    | Material       | Key Classes                                                                            | Title                     | Body                            |
| ------------ | -------------- | -------------------------------------------------------------------------------------- | ------------------------- | ------------------------------- |
| Popover      | Glass          | `glass rounded-md p-2.5 gap-2.5 shadow-soft-md`                                        | `text-base font-medium`   | `text-sm text-text-secondary`   |
| DropdownMenu | Glass          | `glass rounded-md p-1 shadow-soft-md`                                                  | —                         | `text-sm`                       |
| Tooltip      | Inverted Glass | `glass bg-foreground/90 text-background rounded-sm px-3 py-1.5 text-xs shadow-soft-md` | —                         | `text-xs`                       |
| Input        | Soft           | `rounded-sm border border-border-strong bg-surface-raised h-10 px-3 py-2 text-base`    | —                         | —                               |
| Accordion    | Soft borders   | `border-b border-border-strong` per item                                               | `text-base font-semibold` | `text-sm text-muted-foreground` |
| Kbd          | Soft           | `shadow-soft-sm font-mono text-xs`                                                     | —                         | —                               |

---

# Part IV: Patterns

## Sidebar Active State

```
border-l-[3px] border-primary bg-surface-sunken
```

A 3px left border in sprout green with a sunken forest-50 background. Indicates
the current page/section in sidebar navigation. The left border acts as a marker —
like a fresh shoot growing along the page edge.

---

## Tab Active State

```
border-b-[3px] border-primary
```

A 3px bottom border in sprout green. Indicates the active tab in a tab bar. The
underline treatment is distinct from hover (which might use a lighter shade or
opacity).

---

## Brand Lockup

```
text-base font-semibold uppercase tracking-wider
```

The brand name in the sidebar/header. Body font (Switzer), 16px, semibold,
uppercase with wide tracking. Creates a distinctive wordmark without needing a
logo.

---

## Accent Text Indicators

```
text-growth    — checkmarks, positive deltas, success text
text-sprout    — links, interactive elements, active emphasis
text-stigma    — errors, critical warnings inline
text-pistil    — pending, attention-needed inline
```

Accent-colored text directly on surface backgrounds (no tinted background). Used
for inline status indicators, small text annotations, stat deltas. The accent is
the text itself, not a badge or alert container.

---

## Syntax Highlighting / Code Blocks

```
bg-surface-sunken text-sprout | text-haze
```

Code blocks sit in sunken forest-50 surfaces. Primary syntax tokens in sprout
green, secondary/comments in haze. The monospace font (Iosevka) is always used.
Code blocks have `border: 2px solid var(--color-border)` in prose contexts.

---

## Tinted Alert Backgrounds

```
bg-{accent}/10 text-{accent} border-{accent}
```

Alert variants use 10% opacity accent backgrounds with full-strength accent text
and borders. The description text uses `text-{accent}/80` for a slightly softer
read. This pattern is used exclusively in the Alert component — do not replicate
it for other surfaces.

---

## Gradient Decorative Art

```
bg-gradient-to-br from-{accent} via-{accent} to-{accent}
```

Multi-accent gradients for decorative placeholder art (cover images, hero
backgrounds, placeholder visuals). This is a DECORATIVE pattern only — never use
gradients for functional UI surfaces, backgrounds, or buttons. Marketing surfaces
may also reach for raw `brandPalette` hexes here.

---

## Tooltip Inversion

```
glass bg-foreground/90 text-background
```

Tooltips invert the color scheme: near-opaque foreground color as background,
background color as text. Combined with the glass utility for the ring/blur
treatment. The arrow matches: `bg-foreground/90`.

---

# Part V: Implementation Guide

## Importing the Theme

In any app's CSS entry point:

```css
@import "@si/design/theme.css";
```

This single import provides:

- Tailwind v4
- All design tokens (light + dark mode, auto-switching)
- Tailwind theme mapping (colors, shadows, type scale, spacing, radius, breakpoints)
- Typography utilities (`type-hero`, `type-page-title`, etc.)
- Custom font faces (`@font-face` declarations)
- shadcn compatibility layer
- `tw-animate-css` for animations
- `prose-platform` utility
- `glass` and `press-in` utilities

---

## Using `type-*` Utilities

The fluid type utilities are `@utility` definitions. Use them as Tailwind classes:

```html
<h1 class="type-hero">Sprout</h1>
<h2 class="type-page-title">Dashboard</h2>
<p class="type-stat">1,234</p>
<h3 class="type-display-title">Recent Activity</h3>
```

For editorial content:

```html
<h1 class="type-editorial-h1">Article Title</h1>
<p class="type-editorial-lede">Opening paragraph...</p>
<p class="type-editorial-body">Body text...</p>
<blockquote class="type-pullquote">A notable quote.</blockquote>
```

For labels and code:

```html
<span class="type-mono-label">LAST UPDATED</span>
<code class="type-code">const x = 42;</code>
<h4 class="type-section-label">SECTION HEADING</h4>
```

---

## Using the `glass` Utility

```html
<div class="glass rounded-md p-4">Frosted glassmorphic surface</div>
```

The `glass` utility applies:

- Translucent background (`--glass-bg`)
- 1px ring border (`--glass-border`)
- 24px backdrop blur
- Soft drop shadow (`--glass-shadow`)

Never inline these properties manually. Always use the `glass` class.

---

## Using the `press-in` Utility

```html
<button class="active:press-in">Soft press</button>
```

Applies `transform: scale(0.97)`. Used as the `active:` state for soft, neo, and
glass interactive elements — the default press feel across the system.

---

## Using `prose-platform`

```html
<article class="prose prose-platform">
  <h1>Article Title</h1>
  <p>Body text in IBM Plex Serif...</p>
  <blockquote>Pull quote in IBM Plex Serif italic...</blockquote>
</article>
```

Provides:

- IBM Plex Serif for body text
- Zerove for headings (h1–h4) with the fluid type scale
- Sprout-colored links, blockquote borders, inline code
- Proper prose colors mapped to all Sprout tokens
- Styled code blocks with 2px borders

---

## Dark / Light Mode

Light mode is the brand's primary identity; dark mode is the forest canvas. Theme
switching is controlled by the `data-theme` attribute on any ancestor element:

```html
<html data-theme="light">
  <!-- Force light (the primary identity) -->
</html>
<html data-theme="dark">
  <!-- Force dark (the forest canvas) -->
</html>
<html>
  <!-- Follow system preference -->
</html>
```

The CSS uses `@custom-variant dark (&:is([data-theme="dark"] *))` for explicit
dark mode, plus `@media (prefers-color-scheme: dark)` for system-preference
fallback.

---

## What NOT To Do

**Do not reach past the radius scale.** Use the named tokens
(`rounded-xs`/`sm`/`md`/`lg`/`xl`/`full`) — don't invent arbitrary pixel radii.

```html
<!-- WRONG -->
<div class="rounded-[7px] p-4">...</div>

<!-- RIGHT -->
<div class="rounded-md p-4">...</div>
<img class="rounded-full" />
```

**Do not set Zerove tiny.** It is a display face that renders unicase — keep it at
display sizes.

```html
<!-- WRONG -->
<span class="font-heading text-sm">Small heading</span>

<!-- RIGHT -->
<span class="font-heading text-xl">Proper heading</span>
```

**Do not use `glass` on non-floating elements.**

```html
<!-- WRONG — glass on a page-level section -->
<section class="glass p-8">Page content</section>

<!-- RIGHT — glass on a floating overlay -->
<div class="glass rounded-md p-4">Popover content</div>
```

**Do not mix shadow families.**

```html
<!-- WRONG — hard offset shadow + soft elevation on one surface -->
<div class="shadow-brutal-lg shadow-soft-lg">...</div>

<!-- RIGHT — pick one family -->
<div class="border border-border shadow-soft-lg">...</div>
```

**Do not hardcode colors.**

```html
<!-- WRONG -->
<div class="bg-[#F2F2EC] text-[#00240D]">...</div>

<!-- RIGHT -->
<div class="bg-background text-foreground">...</div>
```

**Do not use arbitrary pixel sizes for type.**

```html
<!-- WRONG -->
<h1 class="text-[42px]">Title</h1>

<!-- RIGHT -->
<h1 class="type-page-title">Title</h1>
```

**Do not use monospace for UI text.**

```html
<!-- WRONG -->
<button class="font-mono">Submit</button>

<!-- RIGHT -->
<button class="font-sans">Submit</button>
```

**Do not use the editorial font in UI chrome.**

```html
<!-- WRONG -->
<label class="font-editorial">Email</label>

<!-- RIGHT — editorial is only for long-form content -->
<label class="font-sans">Email</label>
<article class="prose prose-platform">Long-form content here...</article>
```

---

# Rules

1. **Soft, friendly rounding is the norm.** `rounded-sm` (10px) is the default;
   use the larger tokens for bigger surfaces and `rounded-full` for pills,
   avatars, and toggles. Don't invent arbitrary pixel radii.
2. **Display font (Zerove) stays at display sizes.** It renders unicase and shines
   large; if you are using `font-heading` at `text-sm`, you are wrong.
3. **Glass only for floating/overlay elements.** Dialogs, popovers, dropdowns,
   tooltips. Never inline sections.
4. **Soft is the default material.** When in doubt, use soft elevation with a
   hairline border and friendly corners. Pressed (hard-offset) is an occasional
   expressive accent, not the default.
5. **Active states must be distinct from hover.** Hover previews the action;
   active confirms it. They are different interactions.
6. **Mono is for data only.** Timestamps, IDs, code, paths, technical metadata.
   Never for prose or UI labels.
7. **Shadows have meaning — never mix families.** Soft = everyday lift. Neo =
   interactive. Brutal = expressive pop. A surface belongs to one family.
8. **`press-in` for active states.** Scale 0.97. The default press feel for soft,
   neo, and glass elements. Pressed-treatment buttons slam (`translate`).
9. **`glass` utility is the single definition for glassmorphism.** Never inline
   glass background, blur, or ring styles manually.
10. **No arbitrary pixel sizes — use the type scale.** Fixed scale (text-2xs
    through text-xl) or fluid scale (type-hero through type-pullquote).
11. **No hardcoded colors — use tokens.** Every color must come from a CSS custom
    property via a Tailwind class. (Raw `brandPalette` hexes are allowed only in
    decorative marketing visuals.)
12. **Editorial font (IBM Plex Serif) only in long-form content blocks.** Never in
    UI chrome, buttons, labels, or navigation.
