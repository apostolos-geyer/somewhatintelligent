import { fileURLToPath } from "node:url";
import { defineOgConfig, type FontInput } from "@somewhatintelligent/og";

/**
 * Fonts for the OG raster pipeline (`platform-og build`, wired into
 * `vite.config.ts`'s og:build task). satori cannot read CSS custom
 * properties or @font-face — fonts must be handed over as files here.
 * Resolved through the design package specifier so the config survives
 * any repo layout; swap these when rebranding fonts.
 */
const designFont = (rel: string): string =>
  fileURLToPath(import.meta.resolve(`@si/design/fonts/${rel}`));

const fonts: FontInput[] = [
  {
    name: "Barlow Condensed",
    weight: 300,
    style: "normal",
    path: designFont("barlow-condensed/BarlowCondensed-Light.ttf"),
  },
  {
    name: "Barlow Condensed",
    weight: 400,
    style: "normal",
    path: designFont("barlow-condensed/BarlowCondensed-Regular.ttf"),
  },
  {
    name: "Barlow Condensed",
    weight: 700,
    style: "normal",
    path: designFont("barlow-condensed/BarlowCondensed-Bold.ttf"),
  },
  {
    name: "Source Serif 4",
    weight: 400,
    style: "normal",
    path: designFont("source-serif-4/SourceSerif4-Variable.ttf"),
  },
  {
    name: "Source Serif 4",
    weight: 400,
    style: "italic",
    path: designFont("source-serif-4/SourceSerif4-Italic-Variable.ttf"),
  },
  {
    name: "Iosevka",
    weight: 400,
    style: "normal",
    path: designFont("iosevka/Iosevka-Regular.ttf"),
  },
  { name: "Iosevka", weight: 700, style: "normal", path: designFont("iosevka/Iosevka-Bold.ttf") },
];

export default defineOgConfig({ fonts });
