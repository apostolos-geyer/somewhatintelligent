import { ArrowRight, Leaf, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { StarRating } from "./StarRating";
import {
  PRODUCT_TAG_LABEL,
  type Availability,
  type ProductCard as ProductCardData,
} from "@/lib/drops.functions";

/** Availability → badge variant + label. `available` shows no chip (the default). */
const AVAILABILITY_BADGE: Record<
  Availability,
  { variant: "warn" | "danger" | "info"; label: string } | null
> = {
  available: null,
  limited: { variant: "warn", label: "Limited" },
  sold_out: { variant: "danger", label: "Sold out" },
  upcoming: { variant: "info", label: "Upcoming" },
};

/** Format a percentage potency value; null collapses to a dash. */
function formatPct(v: number | null): string {
  if (v == null) return "—";
  return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
}

/**
 * A single product tile inside a Drop-Sheet category strip. Fixed-width so the
 * strip scrolls horizontally; the whole card is the open affordance (flips
 * `?item=` to mount the detail Sheet/Drawer). Shows the hero glyph placeholder
 * (roadie image resolution is deferred — inert locally), the name, a THC/CBD
 * line, availability + "NEW DROP" chips, the Limited "when available" note, and
 * a visible "View Product Details →" affordance.
 */
export function ProductCard({
  product,
  onOpen,
}: {
  product: ProductCardData;
  onOpen: (productId: string) => void;
}) {
  const badge = AVAILABILITY_BADGE[product.availability];
  // Limited SKUs carry the authored `available_note` ("when available") on the
  // card itself, not just in the detail panel (04-ui.md:272, 02-data-model.md:310).
  const showNote = product.availability === "limited" && !!product.availableNote;
  const isRotational = product.tags.includes("rotational");
  // Chips beneath the name: province + the non-rotational descriptor tags
  // (rotational has its own scroll-callout on the hero).
  const chipTags = product.tags.filter((t) => t !== "rotational");
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpen(product.id)}
      aria-label={`View ${product.name} product details`}
      className={cn(
        "group flex w-44 shrink-0 snap-start flex-col gap-3 bg-card p-4 text-left sm:w-52",
        interactiveMaterials.brutal,
      )}
    >
      <div className="relative flex aspect-square items-center justify-center rounded-md bg-primary/5">
        <Leaf className="size-10 text-primary/40" aria-hidden />
        {product.isNewDrop && (
          <Badge variant="sprout" size="sm" className="absolute left-1.5 top-1.5 gap-1">
            <Sparkles className="size-3" aria-hidden />
            New drop
          </Badge>
        )}
        {/* Rotational callout — the visual flag the team wanted while scrolling. */}
        {isRotational && (
          <Badge variant="lime" size="sm" className="absolute right-1.5 top-1.5 gap-1">
            <RefreshCw className="size-3" aria-hidden />
            Rotational
          </Badge>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="truncate font-display font-bold" title={product.name}>
          {product.name}
        </p>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          THC {formatPct(product.thcPct)} · CBD {formatPct(product.cbdPct)}
        </p>
        {/* Average rating on the scroll (read-only stars + count). */}
        {product.averageRating != null && product.reviewCount > 0 && (
          <span className="flex items-center gap-1.5">
            <StarRating
              value={Math.round(product.averageRating)}
              readOnly
              size={13}
              label={`Average rating for ${product.name}`}
            />
            <span className="text-xs tabular-nums text-muted-foreground">
              {product.averageRating.toFixed(1)} ({product.reviewCount})
            </span>
          </span>
        )}
        {product.format && (
          <p className="truncate text-xs text-muted-foreground">{product.format}</p>
        )}
      </div>
      {(chipTags.length > 0 || product.province) && (
        <div className="flex flex-wrap gap-1">
          {product.province && (
            <Badge variant="soft" size="sm">
              {product.province}
            </Badge>
          )}
          {chipTags.map((t) => (
            <Badge key={t} variant="soft" size="sm">
              {PRODUCT_TAG_LABEL[t]}
            </Badge>
          ))}
        </div>
      )}
      {badge && (
        <Badge variant={badge.variant} size="sm" className="w-fit">
          {badge.label}
        </Badge>
      )}
      {showNote && (
        <p
          className="text-xs italic text-muted-foreground"
          title={product.availableNote ?? undefined}
        >
          {product.availableNote}
        </p>
      )}
      {/* Visible open affordance (spec's "View Product Details →") — not just the
          button's aria-label. mt-auto pins it to the bottom of the fixed-height card. */}
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-semibold text-primary">
        View Product Details
        <ArrowRight
          className="size-3 transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
    </button>
  );
}
