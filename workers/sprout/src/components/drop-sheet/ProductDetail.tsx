import { useEffect, useState } from "react";
import {
  ArrowRight,
  ExternalLink,
  FileText,
  Leaf,
  Loader2,
  Newspaper,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@greenroom/ui/components/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@greenroom/ui/components/drawer";
import { useIsMobile } from "@greenroom/ui/hooks/use-mobile";
import { cn } from "@greenroom/ui/lib/utils";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import {
  getProduct,
  listProductContent,
  PRODUCT_TAG_LABEL,
  type Availability,
  type ProductContentLink,
  type ProductDetail as ProductDetailData,
} from "@/lib/drops.functions";
import { ReviewsBlock } from "./ReviewsBlock";
import { StarRating } from "./StarRating";

const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: "Available",
  limited: "Limited",
  sold_out: "Sold out",
  upcoming: "Upcoming",
};

function formatPct(v: number | null): string {
  if (v == null) return "—";
  return `${v % 1 === 0 ? v : v.toFixed(1)}%`;
}

/**
 * The product detail surface — a right-anchored Sheet on desktop, a bottom Drawer
 * on mobile (per the §03 layer pattern). Opened by `?item=<productId>` over the
 * Drop Sheet; closing flips `?item=` back off. Loads the full product via the
 * gated `getProduct` in a useEffect (the detail is client-mounted, not a route
 * loader) — which also emits the `product_view` event. Shows potency, terpenes,
 * effects, talking points, format/batch, a "Full PK →" jump into the deck layer
 * (when a deck is linked), and the reviews block.
 */
export function ProductDetail({ productId, onClose }: { productId: string; onClose: () => void }) {
  const isMobile = useIsMobile();
  const [product, setProduct] = useState<ProductDetailData | null | "missing">(null);

  useEffect(() => {
    let cancelled = false;
    setProduct(null);
    void (async () => {
      try {
        const res = await getProduct({ data: { productId } });
        if (!cancelled) setProduct(res ?? "missing");
      } catch {
        if (!cancelled) setProduct("missing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const title = product && product !== "missing" ? product.name : "Product";
  const body = <DetailBody product={product} onClose={onClose} />;

  if (isMobile) {
    return (
      <Drawer open onOpenChange={(open) => !open && onClose()}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription className="sr-only">Product details and reviews</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">{body}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className="sr-only">Product details and reviews</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  product,
  onClose,
}: {
  product: ProductDetailData | null | "missing";
  onClose: () => void;
}) {
  const { openLayer } = useLayerStack();

  if (product === null) {
    return (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (product === "missing") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Leaf className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">This product isn't available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Hero placeholder + status chips */}
      <div className="relative flex aspect-video items-center justify-center rounded-lg bg-primary/5">
        <Leaf className="size-12 text-primary/40" aria-hidden />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
          <Badge variant="sprout-glass" size="sm">
            {product.category}
          </Badge>
          {product.isNewDrop && (
            <Badge variant="sprout" size="sm">
              New drop
            </Badge>
          )}
          {product.tags.includes("rotational") && (
            <Badge variant="lime" size="sm" className="gap-1">
              <RefreshCw className="size-3" aria-hidden />
              Rotational
            </Badge>
          )}
        </div>
      </div>

      {/* Average rating (read-only) + count. */}
      {product.averageRating != null && product.reviewCount > 0 && (
        <div className="flex items-center gap-2">
          <StarRating
            value={Math.round(product.averageRating)}
            readOnly
            size={18}
            label="Average rating"
          />
          <span className="text-sm font-medium tabular-nums">
            {product.averageRating.toFixed(1)}
          </span>
          <span className="text-sm text-muted-foreground">
            ({product.reviewCount} review{product.reviewCount === 1 ? "" : "s"})
          </span>
        </div>
      )}

      {/* Descriptor tags + province. */}
      {(product.tags.length > 0 || product.province) && (
        <div className="flex flex-wrap gap-1.5">
          {product.province && (
            <Badge variant="soft" size="sm">
              {product.province}
            </Badge>
          )}
          {product.tags.map((t) => (
            <Badge key={t} variant="soft" size="sm">
              {PRODUCT_TAG_LABEL[t]}
            </Badge>
          ))}
        </div>
      )}

      {/* Provincial wholesale link-out (external). */}
      {product.wholesaleUrl && (
        <Button
          variant="outline"
          className="w-full"
          render={<a href={product.wholesaleUrl} target="_blank" rel="noreferrer" />}
        >
          <ExternalLink className="size-4" aria-hidden />
          Provincial wholesale{product.province ? ` (${product.province})` : ""}
        </Button>
      )}

      {/* Potency + meta */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="THC" value={formatPct(product.thcPct)} />
        <Stat label="CBD" value={formatPct(product.cbd)} />
        {product.format && <Stat label="Format" value={product.format} />}
        {product.batch && <Stat label="Batch" value={product.batch} />}
        <Stat label="Availability" value={AVAILABILITY_LABEL[product.availability]} />
      </div>

      {product.availableNote && (
        <p className="rounded-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
          {product.availableNote}
        </p>
      )}

      {/* Terpenes + effects as chip rows */}
      {product.terpenes.length > 0 && (
        <ChipRow title="Terpenes" items={product.terpenes} variant="growth-glass" />
      )}
      {product.effects.length > 0 && (
        <ChipRow title="Effects" items={product.effects} variant="haze-glass" />
      )}

      {/* Talking points */}
      {product.talkingPoints.length > 0 && (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Talking points
          </h4>
          <ul className="space-y-1.5">
            {product.talkingPoints.map((point, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Full PK jump (only when a deck is linked) */}
      {product.deckId && (
        <Button
          type="button"
          variant="strong"
          className="w-full"
          onClick={() => {
            onClose();
            void openLayer("decks", product.deckId ?? undefined);
          }}
        >
          Full PK
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}

      <ContentLinks productId={product.id} onClose={onClose} />

      <div className="border-t border-border pt-4">
        <ReviewsBlock productId={product.id} />
      </div>
    </div>
  );
}

/**
 * "Appears in" — the content the product is featured in (its linked PK deck +
 * feed posts referencing it), from the gated `listProductContent`. Tapping a row
 * closes the detail and opens the matching section layer (decks/feed) on the id.
 * Renders nothing when there are no links (or while loading).
 */
function ContentLinks({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { openLayer } = useLayerStack();
  const [links, setLinks] = useState<ProductContentLink[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    void (async () => {
      try {
        const res = await listProductContent({ data: { productId } });
        if (!cancelled) setLinks(res);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  if (!links || links.length === 0) return null;

  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Appears in
      </h4>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={`${l.type}:${l.id}`}>
            <button
              type="button"
              onClick={() => {
                onClose();
                void openLayer(l.type === "deck" ? "decks" : "feed", l.id);
              }}
              className="flex w-full items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-primary"
            >
              {l.type === "deck" ? (
                <FileText className="size-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <Newspaper className="size-4 shrink-0 text-primary" aria-hidden />
              )}
              <span className="min-w-0 flex-1 truncate">{l.title}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-display font-bold">{value}</p>
    </div>
  );
}

function ChipRow({
  title,
  items,
  variant,
}: {
  title: string;
  items: string[];
  variant: "growth-glass" | "haze-glass";
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className={cn("flex flex-wrap gap-1.5")}>
        {items.map((item, i) => (
          <Badge key={i} variant={variant} size="sm">
            {item}
          </Badge>
        ))}
      </div>
    </section>
  );
}
