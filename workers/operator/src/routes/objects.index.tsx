import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { toast } from "@si/ui/components/sonner";
import { ProductStatusBadge } from "@/components/product-status-badge";
import { createProduct, listProducts } from "@/lib/products.functions";
import { formatCents } from "@/lib/format";

// Objects = the store's products/variants/media surface (RFC-0001 D1).
const FILTERS = ["all", "draft", "active", "unavailable", "archived"] as const;
type Filter = (typeof FILTERS)[number];

function toFilter(value: unknown): Filter {
  return (FILTERS as readonly string[]).includes(String(value)) ? (value as Filter) : "all";
}

// `status` is optional so bare `<Link to="/objects">` (Overview, editor) stays
// valid; "all" is the absence of a filter, not an explicit value.
export const Route = createFileRoute("/objects/")({
  validateSearch: (search: Record<string, unknown>): { status?: Filter; cursor?: string } => {
    const status = toFilter(search.status);
    return {
      status: status === "all" ? undefined : status,
      cursor: typeof search.cursor === "string" ? search.cursor : undefined,
    };
  },
  loaderDeps: ({ search }) => ({ status: search.status, cursor: search.cursor }),
  loader: ({ deps }) => listProducts({ data: { status: deps.status, cursor: deps.cursor } }),
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

const HEADERS = ["Title", "Slug", "Status", "Live version", "Price", ""] as const;

function ObjectsList() {
  const result = Route.useLoaderData();
  const { status, cursor } = Route.useSearch();
  const active: Filter = status ?? "all";
  const router = useRouter();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);

  function onTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit(): Promise<void> {
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toast.error(CREATE_ERROR.invalid_price);
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
        toast.error(CREATE_ERROR[res.error] ?? res.error);
        return;
      }
      setOpen(false);
      toast.success("Draft product created.");
      await navigate({ to: "/objects/$productId", params: { productId: res.value.productId } });
    } catch {
      toast.error("Couldn't create the product. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <div className="flex shrink-0 items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-light tracking-tight">Objects</h1>
          <p className="text-muted-foreground mt-1 text-sm">Products, variants, and stock.</p>
        </div>
        <Button onClick={() => setOpen(true)}>New product</Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() =>
              void navigate({
                to: "/objects",
                search: f === "all" ? {} : { status: f },
              })
            }
            className={
              "rounded-sm border px-3 py-1 font-mono text-xs capitalize transition-colors " +
              (active === f
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {f}
          </button>
        ))}
      </div>

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
          No products in this view.
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-col overflow-hidden p-0 lg:flex-1">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="bg-surface-sunken sticky top-0 z-10">
                <tr>
                  {HEADERS.map((h, i) => (
                    <th
                      key={h || i}
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
          </div>

          {(cursor || result.value.nextCursor) && (
            <div className="border-border flex shrink-0 items-center justify-between border-t px-3 py-2">
              {cursor ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void navigate({ to: "/objects", search: status ? { status } : {} })
                  }
                >
                  ← First page
                </Button>
              ) : (
                <span />
              )}
              {result.value.nextCursor && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigate({
                      to: "/objects",
                      search: { status, cursor: result.value.nextCursor ?? undefined },
                    })
                  }
                >
                  Next page →
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New product</DialogTitle>
            <DialogDescription>
              Create a draft. Store re-slugifies; you can refine everything after.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
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
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !title.trim() || !slug.trim()}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
