import { cn } from "@greenroom/ui/lib/utils";

/**
 * Shared Hub-tile brand treatment — the "pics on tiles, faded with brand colour
 * to fit in" idea. Both the "Your Portals" and "Brands you can join" grids carry
 * a brand's own identity (its uploaded logo + its colour) so disparate brand art
 * still reads coherently on the one Sprout-branded surface.
 *
 * `accent` is the brand's resolved identity colour (a sanitized CSS value from
 * `brand_config`, see `brandAccent`); null ⇒ the neutral Sprout-primary look. The
 * colour is injected only via inline `style`/`color-mix`, so a stored value can
 * never escape its declaration (it was already stripped of `;{}<>` upstream).
 */

/** The square brand chip: the uploaded logo when we resolved one, else the brand
 *  initial — seated on a faint wash of the brand's own colour. */
export function BrandMark({
  name,
  logoUrl,
  accent,
  className,
}: {
  name: string;
  logoUrl: string | null;
  accent: string | null;
  className?: string;
}) {
  const initial = name.charAt(0).toUpperCase() || "?";
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-sm font-display text-xl font-bold",
        accent ? "" : "bg-primary/10 text-primary",
        className,
      )}
      style={
        accent
          ? {
              backgroundColor: `color-mix(in srgb, ${accent} 16%, transparent)`,
              color: accent,
            }
          : undefined
      }
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" loading="lazy" className="size-full object-contain p-1" />
      ) : (
        initial
      )}
    </div>
  );
}

/**
 * The brand-colour wash behind a tile's content: a faint diagonal gradient of the
 * brand colour plus a colour spine on the leading edge. Renders nothing when the
 * brand sets no colour, so a fork with un-themed brands degrades to the plain
 * card. Must sit as the FIRST child of a `relative overflow-hidden` tile so the
 * content paints over it.
 */
export function BrandWash({ accent }: { accent: string | null }) {
  if (!accent) return null;
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `linear-gradient(115deg, color-mix(in srgb, ${accent} 13%, transparent), transparent 62%)`,
        }}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1"
        style={{ background: accent }}
      />
    </>
  );
}
