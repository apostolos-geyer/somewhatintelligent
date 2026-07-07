import { brandThemeToCss, type BrandRuntime } from "@/lib/brand";

/**
 * Injects the per-org runtime skin as a scoped inline <style> in __root's <head>.
 * Because the design tokens are already CSS variables, this single block retints
 * every bg-primary/text-primary/ring-primary surface in one shot — no
 * per-component work, and it SSRs alongside THEME_INIT_SCRIPT so there's no FOUC.
 * Null brand (apex/Hub) or an empty theme → renders nothing (default Sprout skin).
 */
export function BrandStyle({ brand }: { brand: BrandRuntime | null }) {
  if (!brand) return null;
  const css = brandThemeToCss(brand.theme);
  if (!css) return null;
  return <style data-brand={brand.slug} dangerouslySetInnerHTML={{ __html: css }} />;
}
