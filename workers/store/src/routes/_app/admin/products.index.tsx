import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { ProductImage } from "@/components/product-image";
import { createProduct, listAllProducts } from "@/lib/products.functions";
import { formatCents, dollarsToCents } from "@/lib/money";

export const Route = createFileRoute("/_app/admin/products/")({
  loader: async () => listAllProducts(),
  component: AdminProducts,
});

const STATUS_VARIANT: Record<string, React.ComponentProps<typeof Badge>["variant"]> = {
  // DRAFT status stamps: soft = solid-green (live), warn = dashed (draft),
  // info = dotted (archived).
  active: "soft",
  draft: "warn",
  archived: "info",
};

const newProductSchema = type({
  title: "2 <= string <= 120",
  price: "string",
  description: "string",
});

function AdminProducts() {
  const { products } = Route.useLoaderData();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const form = useAppForm({
    defaultValues: { title: "", price: "", description: "" },
    validators: { onChange: newProductSchema },
    onSubmit: async ({ value }) => {
      const cents = dollarsToCents(value.price);
      if (cents === null) {
        toast.error("Enter a valid price");
        return;
      }
      try {
        const res = await createProduct({
          data: {
            title: value.title.trim(),
            priceCents: cents,
            description: value.description.trim() || undefined,
          },
        });
        toast.success("Product created — add images & sizes");
        void navigate({ to: "/admin/products/$id", params: { id: res.id } });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Create failed");
      }
    },
  });

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-text text-xl font-semibold">Catalog</h2>
        <Button onClick={() => setOpen((v) => !v)}>
          <PlusIcon className="size-4" /> New product
        </Button>
      </div>

      {open && (
        <Card className="mb-6 p-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void form.handleSubmit();
            }}
            className="grid gap-4 md:grid-cols-2"
          >
            <form.AppField name="title">
              {(field) => (
                <field.TextField label="Title" placeholder="Heavyweight Box Tee — Black" />
              )}
            </form.AppField>
            <form.AppField name="price">
              {(field) => <field.TextField label="Price (CAD)" placeholder="45.00" />}
            </form.AppField>
            <form.AppField name="description">
              {(field) => (
                <field.TextareaField
                  label="Description"
                  rows={3}
                  placeholder="280gsm cotton, boxy fit, water-based print."
                  className="md:col-span-2"
                />
              )}
            </form.AppField>
            <div className="md:col-span-2">
              <form.AppForm>
                <form.SubmitButton label="Create draft" loadingLabel="Creating…" />
              </form.AppForm>
            </div>
          </form>
        </Card>
      )}

      {products.length === 0 ? (
        <Card variant="soft" className="text-text-tertiary p-12 text-center font-mono text-sm">
          No products yet. Create your first above.
        </Card>
      ) : (
        <div className="grid gap-3">
          {products.map((p) => (
            <Link key={p.id} to="/admin/products/$id" params={{ id: p.id }} className="block">
              <Card className="hover:border-foreground flex flex-row items-center gap-4 p-3 transition-colors">
                <div className="border-border size-14 shrink-0 overflow-hidden rounded border">
                  <ProductImage refId={p.coverRef} alt={p.title} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-text truncate text-sm font-medium">{p.title}</div>
                  <div className="text-text-tertiary font-mono text-xs">/{p.slug}</div>
                </div>
                <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>{p.status}</Badge>
                <span className="text-text-tertiary w-20 text-right font-mono text-xs">
                  {p.totalStock} in stock
                </span>
                <span className="text-text w-20 text-right font-mono text-sm">
                  {formatCents(p.priceCents)}
                </span>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
