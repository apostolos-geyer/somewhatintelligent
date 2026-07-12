import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { ProductImage } from "@/components/product-image";
import { listActiveProducts, type ProductCard } from "@/lib/products.functions";
import { formatCents } from "@/lib/money";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/config";
import { storeOpenFor } from "@/lib/store-gate";

export const Route = createFileRoute("/_public/")({
  // Pre-launch: signed-in non-admins have already joined the list — send them
  // to the thanks page; anonymous visitors get the sign-up landing below.
  beforeLoad: ({ context }) => {
    if (!storeOpenFor(context.session) && context.session) {
      throw redirect({ to: "/welcome" });
    }
  },
  loader: async ({ context }): Promise<{ products: ProductCard[] | null }> =>
    storeOpenFor(context.session) ? listActiveProducts() : { products: null },
  component: Home,
});

function Home() {
  const { products } = Route.useLoaderData();
  // null products ⇒ the gate is closed for this visitor (see loader).
  if (products === null) return <Landing />;
  return (
    <div className="mx-auto max-w-6xl px-4 md:px-6">
      <section className="py-12 md:py-16">
        <p className="text-primary mb-3 font-mono text-xs uppercase tracking-[0.2em]">
          {BRAND_NAME} · apparel
        </p>
        <h1 className="font-display text-foreground max-w-2xl text-[clamp(40px,7vw,76px)] leading-[0.95] font-extralight tracking-tighter">
          {BRAND_NAME}.
        </h1>
        <p className="text-muted-foreground mt-4 max-w-lg text-lg">{BRAND_TAGLINE}</p>
      </section>

      <section className="pb-20">
        <div className="mb-5 flex items-end justify-between">
          <h2 className="text-foreground text-xl font-semibold">The drop</h2>
          <span className="text-muted-foreground font-mono text-xs">{products.length} styles</span>
        </div>

        {products.length === 0 ? (
          <div className="border-border text-muted-foreground rounded-md border border-dashed p-16 text-center font-mono text-sm">
            Nothing live yet — check back soon.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {products.map((p) => (
              <Link
                key={p.id}
                to="/products/$slug"
                params={{ slug: p.slug }}
                className="group block"
              >
                <div className="border-border bg-card relative aspect-square overflow-hidden rounded-md border">
                  <ProductImage
                    refId={p.coverRef}
                    alt={p.title}
                    className="h-full w-full transition-transform duration-300 group-hover:scale-105"
                  />
                  {!p.inStock && (
                    <Badge variant="inverse" className="absolute left-2 top-2">
                      Sold out
                    </Badge>
                  )}
                </div>
                <div className="mt-2.5 flex items-baseline justify-between gap-2">
                  <span className="text-foreground truncate text-sm font-medium">{p.title}</span>
                  <span className="text-muted-foreground font-mono text-sm">
                    {formatCents(p.priceCents)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Pre-launch landing: the only thing a non-admin sees. One job — get an email
// on the list. Sign-up round-trips through identity and lands on /welcome.
function Landing() {
  const signUpHref = `${import.meta.env.IDENTITY_URL}/sign-up?returnTo=${encodeURIComponent(
    `${import.meta.env.STORE_URL}/welcome`,
  )}`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col justify-center px-4 py-24 md:px-6 md:py-36">
      <section className="max-w-2xl">
        <h1 className="font-display text-foreground text-[clamp(40px,7vw,76px)] leading-[0.95] font-extralight tracking-tighter">
          {BRAND_NAME}.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-md text-lg">
          First drop coming soon. Sign up and we&rsquo;ll email you when it&rsquo;s live.
        </p>
        <Button size="lg" className="mt-8" nativeButton={false} render={<a href={signUpHref} />}>
          Sign up
          <ArrowRightIcon className="size-4" />
        </Button>
      </section>
    </div>
  );
}
