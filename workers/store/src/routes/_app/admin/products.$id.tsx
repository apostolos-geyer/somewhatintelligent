import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useRef } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { ExternalLinkIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { ProductImage } from "@/components/product-image";
import { useImageUpload } from "@/hooks/use-image-upload";
import {
  addVariant,
  deleteVariant,
  getProductAdmin,
  updateProduct,
  updateVariantStock,
} from "@/lib/products.functions";
import { deleteProductImage } from "@/lib/upload.functions";
import { dollarsToCents, formatCents } from "@/lib/money";
import { SIZE_ORDER, PRODUCT_STATUSES, type ProductStatus } from "@/lib/config";

const SIZE_OPTIONS = SIZE_ORDER.map((s) => ({ value: s, label: s }));
const STATUS_LABELS: Record<ProductStatus, string> = {
  draft: "Draft (hidden)",
  active: "Active (listed)",
  archived: "Archived",
};
const STATUS_OPTIONS = PRODUCT_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] }));

const detailsSchema = type({
  title: "2 <= string <= 120",
  price: "string",
  status: type.enumerated(...PRODUCT_STATUSES),
  description: "string",
});

export const Route = createFileRoute("/_app/admin/products/$id")({
  loader: async ({ params }) => getProductAdmin({ data: { id: params.id } }),
  component: EditProduct,
});

function EditProduct() {
  const { product, images, variants } = Route.useLoaderData();
  const router = useRouter();
  const { upload, uploading } = useImageUpload();
  const fileInput = useRef<HTMLInputElement>(null);

  const detailsForm = useAppForm({
    defaultValues: {
      title: product.title,
      price: (product.priceCents / 100).toFixed(2),
      status: product.status as string,
      description: product.description ?? "",
    },
    validators: { onChange: detailsSchema },
    onSubmit: async ({ value }) => {
      const cents = dollarsToCents(value.price);
      if (cents === null) {
        toast.error("Invalid price");
        return;
      }
      try {
        await updateProduct({
          data: {
            id: product.id,
            title: value.title,
            priceCents: cents,
            description: value.description,
            status: value.status as ProductStatus,
          },
        });
        toast.success("Saved");
        await router.invalidate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Save failed");
      }
    },
  });

  const sizeForm = useAppForm({
    defaultValues: { size: "M", stock: "25" },
    onSubmit: async ({ value, formApi }) => {
      const stock = Number(value.stock);
      if (!Number.isInteger(stock) || stock < 0) {
        toast.error("Enter a valid stock count");
        return;
      }
      const res = await addVariant({
        data: { productId: product.id, size: value.size.toUpperCase(), stock },
      });
      if (!res.ok) {
        toast.error(res.error === "size_exists" ? "That size already exists" : res.error);
        return;
      }
      formApi.reset();
      await router.invalidate();
    },
  });

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      const res = await upload(product.id, file);
      if (!res.ok) toast.error(`${file.name}: ${res.error}`);
    }
    toast.success("Image(s) uploaded");
    await router.invalidate();
  }

  async function removeImage(imageId: string) {
    await deleteProductImage({ data: { imageId } });
    await router.invalidate();
  }

  async function setStock(id: string, stock: number) {
    await updateVariantStock({ data: { id, stock: Math.max(0, stock) } });
    await router.invalidate();
  }

  async function removeSize(id: string) {
    await deleteVariant({ data: { id } });
    await router.invalidate();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link to="/admin/products" className="text-text-tertiary hover:text-text font-mono text-xs">
          ← catalog
        </Link>
        {product.status === "active" && (
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/products/$slug" params={{ slug: product.slug }} />}
          >
            View live <ExternalLinkIcon className="size-3.5" />
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Details */}
        <Card className="p-6">
          <h2 className="text-text mb-4 font-semibold">Details</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void detailsForm.handleSubmit();
            }}
            className="grid gap-4"
          >
            <detailsForm.AppField name="title">
              {(field) => <field.TextField label="Title" />}
            </detailsForm.AppField>
            <div className="grid grid-cols-2 gap-4">
              <detailsForm.AppField name="price">
                {(field) => <field.TextField label="Price (CAD)" />}
              </detailsForm.AppField>
              <detailsForm.AppField name="status">
                {(field) => <field.SelectField label="Status" options={STATUS_OPTIONS} />}
              </detailsForm.AppField>
            </div>
            <detailsForm.AppField name="description">
              {(field) => <field.TextareaField label="Description" rows={4} />}
            </detailsForm.AppField>
            <detailsForm.AppForm>
              <detailsForm.SubmitButton label="Save details" loadingLabel="Saving…" />
            </detailsForm.AppForm>
          </form>
        </Card>

        {/* Images */}
        <Card className="p-6">
          <h2 className="text-text mb-1 font-semibold">Images</h2>
          <p className="text-text-tertiary mb-4 font-mono text-xs">
            Uploaded to R2 via the roadie binding. First image is the cover.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {images.map((img) => (
              <div key={img.id} className="group relative">
                <div className="border-border aspect-square overflow-hidden rounded border-2">
                  <ProductImage
                    refId={img.uploadedAt ? img.roadieReferenceId : null}
                    alt={img.alt ?? ""}
                    className="h-full w-full"
                  />
                </div>
                <button
                  onClick={() => void removeImage(img.id)}
                  className="bg-destructive text-primary-foreground absolute -right-2 -top-2 rounded-full p-1 opacity-0 transition-opacity group-hover:opacity-100"
                  aria-label="Delete image"
                >
                  <Trash2Icon className="size-3.5" />
                </button>
                {!img.uploadedAt && (
                  <span className="text-ochre absolute bottom-1 left-1 font-mono text-[10px]">
                    pending
                  </span>
                )}
              </div>
            ))}
            <button
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="border-border text-text-tertiary hover:border-foreground hover:text-text flex aspect-square flex-col items-center justify-center gap-1 rounded border-2 border-dashed text-xs transition-colors disabled:opacity-50"
            >
              <UploadIcon className="size-5" />
              {uploading ? "Uploading…" : "Add"}
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => void onFiles(e.target.files)}
          />
        </Card>
      </div>

      {/* Variants / sizes */}
      <Card className="p-6">
        <h2 className="text-text mb-4 font-semibold">Sizes & stock</h2>
        <div className="space-y-2">
          {variants.length === 0 && (
            <p className="text-text-tertiary font-mono text-sm">No sizes yet — add one below.</p>
          )}
          {variants.map((v) => (
            <div
              key={v.id}
              className="border-border flex items-center gap-3 rounded border-2 p-2.5"
            >
              <span className="text-text w-12 font-mono text-sm font-semibold">{v.size}</span>
              <span className="text-text-tertiary flex-1 font-mono text-xs">{v.sku}</span>
              <Label className="text-text-tertiary font-mono text-xs">stock</Label>
              <Input
                type="number"
                min={0}
                defaultValue={v.stock}
                className="h-8 w-20"
                onBlur={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n !== v.stock) void setStock(v.id, n);
                }}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void removeSize(v.id)}
                aria-label="Delete size"
              >
                <Trash2Icon className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sizeForm.handleSubmit();
          }}
          className="border-border mt-4 flex items-end gap-3 border-t-2 border-dashed pt-4"
        >
          <sizeForm.AppField name="size">
            {(field) => <field.SelectField label="Size" options={SIZE_OPTIONS} className="w-32" />}
          </sizeForm.AppField>
          <sizeForm.AppField name="stock">
            {(field) => <field.TextField label="Stock" className="w-28" />}
          </sizeForm.AppField>
          <sizeForm.AppForm>
            <sizeForm.SubmitButton label="Add size" variant="outline" />
          </sizeForm.AppForm>
        </form>
        <p className="text-text-tertiary mt-4 font-mono text-xs">
          Listed price: {formatCents(product.priceCents)}
        </p>
      </Card>
    </div>
  );
}
