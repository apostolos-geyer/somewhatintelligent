import { createFileRoute, Link } from "@tanstack/react-router";
import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { ProductImage } from "@/components/product-image";
import { useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";

export const Route = createFileRoute("/_public/cart")({
  component: CartPage,
});

function CartPage() {
  const { lines, setQty, remove, subtotalCents, count } = useCart();

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-text mb-6 text-3xl font-light tracking-tight">Your cart</h1>

      {lines.length === 0 ? (
        <Card variant="soft" className="p-12 text-center">
          <p className="text-text-tertiary font-mono text-sm">Your cart is empty.</p>
          <Button className="mt-4" nativeButton={false} render={<Link to="/" />}>
            Browse the shop
          </Button>
        </Card>
      ) : (
        <>
          <Card className="divide-border divide-y p-0">
            {lines.map((l) => (
              <div key={l.variantId} className="flex items-center gap-4 p-4">
                <Link
                  to="/products/$slug"
                  params={{ slug: l.slug }}
                  className="border-border size-16 shrink-0 overflow-hidden rounded border"
                >
                  <ProductImage refId={l.coverRef} alt={l.title} className="h-full w-full" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="text-text truncate text-sm font-medium">{l.title}</div>
                  <div className="text-text-tertiary font-mono text-xs">Size {l.size}</div>
                  <div className="text-text-secondary mt-0.5 font-mono text-xs">
                    {formatCents(l.priceCents)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setQty(l.variantId, l.quantity - 1)}
                    aria-label="Decrease"
                  >
                    <MinusIcon className="size-3.5" />
                  </Button>
                  <span className="w-7 text-center font-mono text-sm">{l.quantity}</span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setQty(l.variantId, l.quantity + 1)}
                    aria-label="Increase"
                  >
                    <PlusIcon className="size-3.5" />
                  </Button>
                </div>
                <div className="w-20 text-right font-mono text-sm">
                  {formatCents(l.priceCents * l.quantity)}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => remove(l.variantId)}
                  aria-label="Remove"
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              </div>
            ))}
          </Card>

          <div className="mt-6 flex items-center justify-between">
            <div className="text-text-tertiary font-mono text-sm">
              {count} item{count === 1 ? "" : "s"}
            </div>
            <div className="text-text text-right">
              <div className="text-text-tertiary font-mono text-xs">Subtotal</div>
              <div className="font-display text-2xl font-light">{formatCents(subtotalCents)}</div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button size="lg" nativeButton={false} render={<Link to="/checkout" />}>
              Checkout
            </Button>
          </div>
          <p className="text-text-tertiary mt-2 text-right font-mono text-xs">
            Shipping calculated at checkout · free over $75
          </p>
        </>
      )}
    </div>
  );
}
