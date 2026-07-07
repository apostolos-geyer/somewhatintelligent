import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type FontStyle = "normal" | "italic";

export type SatoriFont = {
  name: string;
  weight: FontWeight;
  style: FontStyle;
  data: Buffer;
};

async function load(spec: string): Promise<Buffer> {
  return readFile(require.resolve(spec));
}

let cached: SatoriFont[] | null = null;

export async function loadFonts(): Promise<SatoriFont[]> {
  if (cached) return cached;

  const [
    aileLight,
    aileRegular,
    aileMedium,
    aileSemiBold,
    aileBold,
    aileItalic,
    iosevkaRegular,
    iosevkaBold,
  ] = await Promise.all([
    load("@si/design/fonts/iosevka-aile/IosevkaAile-Light.ttf"),
    load("@si/design/fonts/iosevka-aile/IosevkaAile-Regular.ttf"),
    load("@si/design/fonts/iosevka-aile/IosevkaAile-Medium.ttf"),
    load("@si/design/fonts/iosevka-aile/IosevkaAile-SemiBold.ttf"),
    load("@si/design/fonts/iosevka-aile/IosevkaAile-Bold.ttf"),
    load("@si/design/fonts/iosevka-aile/IosevkaAile-Italic.ttf"),
    load("@si/design/fonts/iosevka/Iosevka-Regular.ttf"),
    load("@si/design/fonts/iosevka/Iosevka-Bold.ttf"),
  ]);

  cached = [
    { name: "Iosevka Aile", weight: 300, style: "normal", data: aileLight },
    { name: "Iosevka Aile", weight: 400, style: "normal", data: aileRegular },
    { name: "Iosevka Aile", weight: 500, style: "normal", data: aileMedium },
    { name: "Iosevka Aile", weight: 600, style: "normal", data: aileSemiBold },
    { name: "Iosevka Aile", weight: 700, style: "normal", data: aileBold },
    { name: "Iosevka Aile", weight: 400, style: "italic", data: aileItalic },
    { name: "Iosevka", weight: 400, style: "normal", data: iosevkaRegular },
    { name: "Iosevka", weight: 700, style: "normal", data: iosevkaBold },
  ];
  return cached;
}
