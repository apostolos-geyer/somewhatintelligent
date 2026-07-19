import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { ProductStatusBadge } from "@/components/product-status-badge";
import { createProduct, listProducts } from "@/lib/products.functions";
import { formatCents } from "@/lib/format";

// Objects = the store's products/variants/media surface (RFC-0001 D1).
export const Route = createFileRoute("/objects/")({
  loader: () => listProducts({ data: {} }),
  component: ObjectsList,
});

/** Client-side slug suggestion; Store is authoritative and re-slugifies. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const CREATE_ERROR: Record<string, string> = {
  slug_taken: "That slug is already in use — pick another.",
  invalid_price: "Enter a price of $0.00 or more.",
};

function ObjectsList() {
  const result = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit(): Promise<void> {
    setError(null);
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("invalid_price");
      return;
    }
    setBusy(true);
    try {
      const res = await createProduct({
        data: {
          commandId: crypto.randomUUID(),
          slug: slug.trim(),
          title: title.trim(),
          priceCents: Math.round(dollars * 100),
        },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await navigate({ to: "/objects/$productId", params: { productId: res.value.productId } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-light tracking-tight">Objects</h1>
          <p className="text-muted-foreground mt-1 text-sm">Products, variants, and stock.</p>
        </div>
        <Button variant={open ? "outline" : "default"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "New product"}
        </Button>
      </div>

      {open && (
        <Card variant="soft" className="mb-6 p-5">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't create the product</AlertTitle>
                <AlertDescription>{CREATE_ERROR[error] ?? error}</AlertDescription>
              </Alert>
            )}
            <div className="grid gap-2">
              <Label htmlFor="new-title">Title</Label>
              <Input
                id="new-title"
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="Oxford Overshirt"
                required
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="new-slug">Slug</Label>
                <Input
                  id="new-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugEdited(true);
                    setSlug(e.target.value);
                  }}
                  placeholder="oxford-overshirt"
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-price">Price (CAD)</Label>
                <Input
                  id="new-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <div>
              <Button type="submit" disabled={busy || !title.trim() || !slug.trim()}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {!result.ok ? (
        <Card variant="soft" className="p-8 text-center">
          <p className="text-destructive font-mono text-sm">Couldn't load products.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void router.invalidate()}
          >
            Retry
          </Button>
        </Card>
      ) : result.value.products.length === 0 ? (
        <Card variant="soft" className="text-muted-foreground p-12 text-center font-mono text-sm">
          No products yet. Create your first draft.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-sunken">
                {["Title", "Slug", "Status", "Live version", "Price", ""].map((h) => (
                  <th
                    key={h}
                    className="text-muted-foreground border-border border-b p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.value.products.map((p, i) => (
                <tr
                  key={p.productId}
                  className={i < result.value.products.length - 1 ? "border-border border-b" : ""}
                >
                  <td className="text-foreground p-3 text-sm font-semibold">{p.title}</td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">{p.slug}</td>
                  <td className="p-3">
                    <ProductStatusBadge status={p.status} />
                  </td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">
                    {p.activeVersion ?? "—"}
                  </td>
                  <td className="text-foreground p-3 font-mono text-sm">
                    {formatCents(p.priceCents)}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      to="/objects/$productId"
                      params={{ productId: p.productId }}
                      className="text-primary font-mono text-xs underline-offset-4 hover:underline"
                    >
                      manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
