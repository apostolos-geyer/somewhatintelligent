import { googleFamiliesInFonts, googleFontsHref } from "@/lib/google-fonts";
import type { BrandRuntime } from "@/lib/brand";

/**
 * Loads the Google Fonts a brand's theme references, so a chosen webfont
 * actually renders on the live portal. `brandThemeToCss` only points `--font-*`
 * at a family stack ("'Inter', sans-serif"); the font file still has to be
 * fetched. This emits the standard preconnect pair + one css2 <link> in <head>,
 * SSR'd alongside <BrandStyle> so there's no flash of fallback text.
 *
 * A null brand (apex/Hub) or a theme that only uses the bundled Sprout faces →
 * renders nothing.
 */
export function BrandFonts({ brand }: { brand: BrandRuntime | null }) {
  if (!brand) return null;
  const href = googleFontsHref(googleFamiliesInFonts(brand.theme.fonts));
  if (!href) return null;
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={href} />
    </>
  );
}
