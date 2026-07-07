# Sprout — Marketing Videos (Remotion)

Programmatic marketing videos for **Sprout**, the white-label B2B
budtender-portal platform (`workers/sprout`). Built with
[Remotion](https://remotion.dev) — videos are React components, rendered to MP4.

The content is grounded in the real product: the **user journeys** in
[`../docs/sprout`](../docs/sprout) (especially `user-journey-report.pdf` and
`04-ui.md`) and the brand design tokens + typefaces in
[`../packages/design`](../packages/design). Colours mirror
`packages/design/src/tokens/colors.ts` (warm-espresso dark canvas, sprout-lime
glow) and the fonts are the brand set — **Zerove** (display), **Switzer**
(body), **Quadrillion** (accent), **Iosevka** (mono) — copied into `public/fonts`
so renders work fully offline.

## Compositions

| ID                    | Format         | Length | What it sells                                                                                                      |
| --------------------- | -------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| `SproutOverview`      | 1920×1080      | ~34s   | The flagship film: one engine / infinite skins → sections → Drop Sheet → AI assistant → the Hub & Education Award. |
| `SpotlightWhiteLabel` | 1080×1920 9:16 | 12s    | "One engine, infinite skins" — a phone cycling MTL / Dom Jackson / Lite Label skins.                               |
| `SpotlightDropSheet`  | 1080×1920 9:16 | 12s    | The Drop Sheet — live lineup + honest budtender reviews.                                                           |
| `SpotlightLearnEarn`  | 1080×1920 9:16 | 12s    | "Learn Green, Earn Green" — the Hub, leaderboard, and the Education Award.                                         |

## Develop

This project is intentionally **outside** the bun workspace (it is not under
`workers/` or `packages/`), so it has its own `node_modules` and does
not interact with the monorepo's catalog/overrides. Use plain `npm`.

```sh
cd marketing-videos
npm install
npm run studio          # open Remotion Studio to preview / scrub
```

## Render

```sh
npm run render:all              # all four → out/
npm run render:overview         # just the flagship
npm run render:white-label
npm run render:drop-sheet
npm run render:learn-earn
```

Outputs land in `out/` (gitignored). H.264 MP4, CRF 18.

In memory/IO-constrained environments (some CI containers), a single long
render of the flagship can intermittently stall a font load on a late frame.
Use the chunked renderer instead — it renders the overview in short segments
(with retries) and stitches them losslessly with `remotion ffmpeg`:

```sh
npm run render:overview:safe
```

## Structure

```
src/
  index.ts                 registerRoot
  Root.tsx                 <Composition> registrations
  theme.ts                 brand colours + the three demo skins
  load-fonts.ts            local brand fonts via @remotion/fonts
  components/              Backdrop, Wordmark, Typography, Device frames, UI mocks
  compositions/            SproutOverview, Spotlights
public/fonts/              brand woff2/otf (copied from packages/design)
```

## Notes (Remotion best-practices skill)

Installed via `npx skills add remotion-dev/skills` (see
`.agents/skills/remotion-best-practices`). Key rules followed here: all motion
is driven by `useCurrentFrame()` + `interpolate`/`spring` (never CSS
transitions/animations), scenes are sequenced with
`@remotion/transitions`, and fonts are awaited before frames render.
