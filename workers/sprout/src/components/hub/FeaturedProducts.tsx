import { Leaf } from "lucide-react";
import { FeaturedCarousel } from "@/components/hub/FeaturedCarousel";

/**
 * Hub — "Featured Products". A cross-brand discovery row of standout drops. No
 * platform-wide featured-product model is wired yet, so the section presents as
 * honestly Coming-soon (`FeaturedCarousel` → `ComingSoon`): nothing fake by
 * default, the sample row only behind an explicit preview. Wiring it later = swap
 * `SAMPLE_PRODUCTS` for a `getFeaturedProducts` read (e.g. top-rated drops).
 */
interface SampleProduct {
  name: string;
  category: string;
}

const SAMPLE_PRODUCTS: SampleProduct[] = [
  { name: "Garlic Breath", category: "Flower" },
  { name: "Live Rosin — Batch 14", category: "Extract" },
  { name: "Sunset Sherbet Pre-Roll", category: "Pre-Roll" },
  { name: "Temple Ball Hash", category: "Hash" },
  { name: "Midnight Mint Gummies", category: "Edible" },
];

export function FeaturedProducts() {
  return (
    <FeaturedCarousel
      icon={Leaf}
      title="Featured Products"
      subtitle="Standout drops worth knowing — curated across the platform."
      blurb="A monthly shortlist of drops worth knowing, pulled from across the platform."
    >
      {SAMPLE_PRODUCTS.map((p) => (
        <ProductCard key={p.name} product={p} />
      ))}
    </FeaturedCarousel>
  );
}

function ProductCard({ product }: { product: SampleProduct }) {
  return (
    <article
      role="listitem"
      className="flex w-44 shrink-0 snap-start flex-col overflow-hidden rounded-md border border-border bg-card"
    >
      <div className="flex h-28 items-center justify-center bg-gradient-to-br from-primary/15 via-primary/5 to-transparent">
        <Leaf className="size-8 text-primary/70" aria-hidden />
      </div>
      <div className="space-y-1 p-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {product.category}
        </span>
        <p className="line-clamp-1 text-sm font-medium" title={product.name}>
          {product.name}
        </p>
      </div>
    </article>
  );
}
