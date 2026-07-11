import { fileURLToPath } from "node:url";
import { defineOgConfig, type FontInput, type FontWeight } from "@somewhatintelligent/og";

/**
 * Fonts for the OG raster pipeline (`platform-og build`, wired into
 * `vite.config.ts`'s og:build task). satori cannot read CSS custom
 * properties or @font-face — fonts must be handed over as files here.
 * Resolved through the design package specifier so the config survives
 * any repo layout; swap these when rebranding fonts.
 */
const designFont = (rel: string): string =>
  fileURLToPath(import.meta.resolve(`@si/design/fonts/${rel}`));

const weights: Array<[FontWeight, string]> = [
  [300, "IosevkaAile-Light.ttf"],
  [400, "IosevkaAile-Regular.ttf"],
  [500, "IosevkaAile-Medium.ttf"],
  [600, "IosevkaAile-SemiBold.ttf"],
  [700, "IosevkaAile-Bold.ttf"],
];

const fonts: FontInput[] = [
  ...weights.map(
    ([weight, file]): FontInput => ({
      name: "Iosevka Aile",
      weight,
      style: "normal",
      path: designFont(`iosevka-aile/${file}`),
    }),
  ),
  {
    name: "Iosevka Aile",
    weight: 400,
    style: "italic",
    path: designFont("iosevka-aile/IosevkaAile-Italic.ttf"),
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
