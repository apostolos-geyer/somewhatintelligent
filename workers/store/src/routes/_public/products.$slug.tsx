import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, ShoppingBagIcon } from "lucide-react";
import { useCapture } from "@si/analytics/client";
import { Button } from "@si/ui/components/button";
import { Badge } from "@si/ui/components/badge";
import { ProductImage } from "@/components/product-image";
import { getProductBySlug } from "@/lib/products.functions";
import { formatCents } from "@/lib/money";
import { useCart } from "@/lib/cart";

export const Route = createFileRoute("/_public/products/$slug")({
  loader: async ({ params }) => getProductBySlug({ data: { slug: params.slug } }),
  component: ProductDetail,
});

function ProductDetail() {
  const { product, images, variants } = Route.useLoaderData();
  const router = useRouter();
  const { add } = useCart();
  const capture = useCapture();
  const [activeImage, setActiveImage] = useState(0);
  const [variantId, setVariantId] = useState<string | null>(
    variants.find((v) => v.stock > 0)?.id ?? null,
  );

  const coverRef = images[0]?.roadieReferenceId ?? null;
  const selected = variants.find((v) => v.id === variantId) ?? null;

  useEffect(() => {
    capture("product_viewed", {
      product_id: product.id,
      product_slug: product.slug,
      product_name: product.title,
      price_cents: product.priceCents,
      in_stock: variants.some((v) => v.stock > 0),
    });
  }, [product.id]);

  function addToCart() {
    if (!selected) {
      toast.error("Pick a size first");
      return;
    }
    add(
      {
        variantId: selected.id,
        productId: product.id,
        slug: product.slug,
        title: product.title,
        size: selected.size,
        priceCents: product.priceCents,
        coverRef,
      },
      1,
    );
    capture("cart_item_added", {
      product_id: product.id,
      variant_id: selected.id,
      product_name: product.title,
      size: selected.size,
      price_cents: product.priceCents,
    });
    toast.success(`Added ${product.title} (${selected.size}) to cart`);
    void router.invalidate();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="grid gap-8 md:grid-cols-2 md:gap-12">
        {/* Gallery */}
        <div>
          <div className="border-border bg-card aspect-square overflow-hidden rounded-md border">
            <ProductImage
              refId={images[activeImage]?.roadieReferenceId ?? coverRef}
              alt={product.title}
              className="h-full w-full"
            />
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {images.map((img, i) => (
                <button
                  key={img.id}
                  onClick={() => setActiveImage(i)}
                  className={
                    "border-border size-16 overflow-hidden rounded border " +
                    (i === activeImage ? "ring-primary ring-2" : "opacity-70")
                  }
                >
                  <ProductImage refId={img.roadieReferenceId} alt="" className="h-full w-full" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div>
          <h1 className="font-display text-text text-4xl font-light tracking-tight">
            {product.title}
          </h1>
          <p className="text-text-secondary mt-2 font-mono text-2xl">
            {formatCents(product.priceCents)}
          </p>

          {product.description && (
            <p className="text-text-secondary mt-6 whitespace-pre-wrap leading-relaxed">
              {product.description}
            </p>
          )}

          <div className="mt-8">
            <p className="text-text-tertiary mb-2 font-mono text-xs uppercase tracking-wider">
              Size
            </p>
            <div className="flex flex-wrap gap-2">
              {variants.length === 0 && (
                <span className="text-text-tertiary text-sm">No sizes available.</span>
              )}
              {variants.map((v) => {
                const out = v.stock <= 0;
                const active = v.id === variantId;
                return (
                  <button
                    key={v.id}
                    disabled={out}
                    onClick={() => setVariantId(v.id)}
                    className={
                      "min-w-12 rounded-sm border-2 px-3 py-2 text-sm font-medium transition-colors " +
                      (out
                        ? "border-border text-text-tertiary cursor-not-allowed line-through opacity-50"
                        : active
                          ? "border-primary text-text"
                          : "border-input text-text-secondary hover:border-foreground")
                    }
                  >
                    {v.size}
                  </button>
                );
              })}
            </div>
            {selected && selected.stock <= 5 && selected.stock > 0 && (
              <p className="text-ochre mt-2 font-mono text-xs">Only {selected.stock} left</p>
            )}
          </div>

          <div className="mt-8 flex items-center gap-3">
            <Button size="lg" onClick={addToCart} disabled={!selected}>
              <ShoppingBagIcon className="size-4" /> Add to cart
            </Button>
            {variants.some((v) => v.stock > 0) ? (
              <Badge variant="soft">
                <CheckIcon className="size-3" /> In stock
              </Badge>
            ) : (
              <Badge variant="contrast">Sold out</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
