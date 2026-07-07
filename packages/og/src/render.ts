import type { ReactNode } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { loadFonts, type SatoriFont } from "./fonts.ts";

export type RenderOptions = {
  size: { width: number; height: number };
  fonts?: SatoriFont[];
};

export async function renderOg(element: ReactNode, options: RenderOptions): Promise<Uint8Array> {
  const fonts = options.fonts ?? (await loadFonts());
  const svg = await satori(element, {
    width: options.size.width,
    height: options.size.height,
    fonts,
  });
  return new Resvg(svg).render().asPng();
}
