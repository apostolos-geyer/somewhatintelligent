import { ArrowUpRight, Star } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { BrandMark, BrandWash } from "@/components/hub/tile-brand";
import type { FeaturedBrand as FeaturedBrandData } from "@/lib/hub.functions";

/**
 * Hub — "Featured Brand of the Month". A GLOBAL editorial spotlight (the same
 * brand for every budtender this month, advancing when the period turns), NOT the
 * viewer's own brand — so it's a cross-brand discovery surface. Wears the featured
 * brand's logo + colour wash (same treatment as the portal tiles) and links
 * cross-host to its public portal; the CTA label adapts to whether the viewer is
 * already a member. Renders nothing if the directory is empty.
 */
export function FeaturedBrand({ brand }: { brand: FeaturedBrandData | null }) {
  if (!brand) return null;
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Star className="size-6 text-primary" aria-hidden />
          Featured Brand of the Month
        </h2>
        <p className="text-sm text-muted-foreground">
          A different brand in the spotlight every month — get to know the platform.
        </p>
      </header>

      <a
        href={brand.portalUrl}
        className="group/feat block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sprout"
        aria-label={`${brand.isMember ? "Open" : "View"} ${brand.name}`}
      >
        <Card
          variant="soft"
          className={cn(
            "relative flex flex-col gap-4 overflow-hidden p-5 sm:flex-row sm:items-center sm:gap-5",
            interactiveMaterials.brutal,
          )}
        >
          <BrandWash accent={brand.accent} />
          <BrandMark
            name={brand.name}
            logoUrl={brand.logoUrl}
            accent={brand.accent}
            className="size-16 text-2xl sm:size-20 sm:text-3xl"
          />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Badge variant="sprout-glass" className="gap-1">
              <Star className="size-3" aria-hidden />
              Featured this month
            </Badge>
            <h3 className="truncate font-display text-xl font-bold" title={brand.name}>
              {brand.name}
            </h3>
            {brand.tagline && (
              <p className="line-clamp-2 text-sm text-muted-foreground">{brand.tagline}</p>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-sm border border-border px-3 py-1.5 text-sm font-medium transition-colors group-hover/feat:border-primary group-hover/feat:text-primary sm:self-auto">
            {brand.isMember ? "Open portal" : "View brand"}
            <ArrowUpRight className="size-4" aria-hidden />
          </span>
        </Card>
      </a>
    </section>
  );
}
