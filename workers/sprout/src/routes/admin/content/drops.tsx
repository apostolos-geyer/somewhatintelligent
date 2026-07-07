import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { Plus, Sparkles } from "lucide-react";
import { useAppForm, withForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Badge } from "@greenroom/ui/components/badge";
import {
  archiveProduct,
  listAdminProducts,
  CANADIAN_PROVINCES,
  PRODUCT_CATEGORIES,
  upsertDrop,
  upsertProduct,
  type AdminProductView,
  type ProductCategory,
} from "@/lib/drops.functions";
import { AdminPageHeader, AdminSection } from "@/components/admin/AdminScaffold";
import { ArchiveButton, ListRow, RowEditButton } from "@/components/admin/ListRow";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import { parseDateTime } from "@/components/admin/datetime";

/**
 * Brand-Admin Drop-Sheet management (P2.A). Nests under the pathless `admin.tsx`
 * guard — SELF-CONTAINED (imports no Admin setup chrome). Mutations are brand-role
 * gated server-side (`decideBrandAdmin`); brand_id is the envelope's activeOrgId,
 * never sent. Manages products per category (create/edit/archive via `useAppForm`)
 * and opens a timed drop on a product.
 */
export const Route = createFileRoute("/admin/content/drops")({
  loader: () => listAdminProducts(),
  component: AdminDropsPage,
});

function AdminDropsPage() {
  const products = Route.useLoaderData();
  const router = useRouter();
  const [editing, setEditing] = useState<AdminProductView | "new" | null>(null);
  const [dropping, setDropping] = useState<AdminProductView | null>(null);

  // Group the admin list by category for the management view.
  const byCategory = PRODUCT_CATEGORIES.map((category) => ({
    category,
    items: products.filter((p) => p.category === category),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Drop Sheet"
        description="The product lineup budtenders browse, grouped by category. Open a timed drop to flag a release as new."
        action={
          <Button type="button" variant="strong" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New product
          </Button>
        }
      />

      {products.length === 0 && (
        <p className="text-sm text-muted-foreground">No products yet. Add one above.</p>
      )}

      {byCategory.map((group) => (
        <AdminSection key={group.category} title={group.category}>
          <ul className="space-y-2">
            {group.items.map((product) => (
              <ListRow
                key={product.id}
                dimmed={product.archivedAt != null}
                title={product.name}
                meta={
                  <>
                    THC {product.thcPct ?? "—"}% · CBD {product.cbdPct ?? "—"}%
                    {product.format ? ` · ${product.format}` : ""}
                  </>
                }
                actions={
                  <>
                    {product.status === "draft" && <Badge variant="warn">Draft</Badge>}
                    {product.archivedAt && <Badge variant="outline">Archived</Badge>}
                    {product.deckId && <Badge variant="info">PK deck</Badge>}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setDropping(product)}
                      aria-label={`Open a drop for ${product.name}`}
                    >
                      <Sparkles className="size-4" aria-hidden />
                      Drop
                    </Button>
                    <RowEditButton
                      ariaLabel={`Edit ${product.name}`}
                      onClick={() => setEditing(product)}
                    />
                    {!product.archivedAt && (
                      <ArchiveButton
                        name={product.name}
                        archive={() => archiveProduct({ data: { productId: product.id } })}
                        onArchived={() => void router.invalidate()}
                      />
                    )}
                  </>
                }
              />
            ))}
          </ul>
        </AdminSection>
      ))}

      {editing && (
        <ProductDialog
          product={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void router.invalidate();
          }}
        />
      )}

      {dropping && (
        <DropDialog
          product={dropping}
          onClose={() => setDropping(null)}
          onSaved={() => {
            setDropping(null);
            void router.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ─── product create / edit ──────────────────────────────────────────────────

const productSchema = type({
  category: "string >= 1",
  name: "string >= 1",
  thcPct: "string",
  cbdPct: "string",
  format: "string",
  batch: "string",
  availability: "string >= 1",
  availableNote: "string",
  wholesaleUrl: "string",
  province: "string",
  tagRotational: "boolean",
  tagFlowThrough: "boolean",
  tagWholesale: "boolean",
  deckId: "string",
  terpenes: "string",
  effects: "string",
  talkingPoints: "string",
  status: "string >= 1",
});

/** Parse a newline/comma-separated textarea into a trimmed, non-empty string list. */
function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse a numeric text field; blank → undefined, non-numeric → undefined. */
function parseNum(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((c) => ({ value: c, label: c }));
const AVAILABILITY_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "limited", label: "Limited" },
  { value: "sold_out", label: "Sold out" },
  { value: "upcoming", label: "Upcoming" },
];
const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
];
const PROVINCE_OPTIONS = [
  { value: "", label: "— None —" },
  ...CANADIAN_PROVINCES.map((p) => ({ value: p, label: p })),
];

const numText = (n: number | null) => (n != null ? String(n) : "");

interface ProductFormValues {
  category: string;
  name: string;
  thcPct: string;
  cbdPct: string;
  format: string;
  batch: string;
  availability: string;
  availableNote: string;
  wholesaleUrl: string;
  province: string;
  tagRotational: boolean;
  tagFlowThrough: boolean;
  tagWholesale: boolean;
  deckId: string;
  terpenes: string;
  effects: string;
  talkingPoints: string;
  status: string;
}

const NEW_PRODUCT_DEFAULTS: ProductFormValues = {
  category: "Flower",
  name: "",
  thcPct: "",
  cbdPct: "",
  format: "",
  batch: "",
  availability: "available",
  availableNote: "",
  wholesaleUrl: "",
  province: "",
  tagRotational: false,
  tagFlowThrough: false,
  tagWholesale: false,
  deckId: "",
  terpenes: "",
  effects: "",
  talkingPoints: "",
  status: "draft",
};

function productDefaults(product: AdminProductView | null): ProductFormValues {
  if (!product) return NEW_PRODUCT_DEFAULTS;
  return {
    category: product.category,
    name: product.name,
    thcPct: numText(product.thcPct),
    cbdPct: numText(product.cbdPct),
    format: product.format ?? "",
    batch: product.batch ?? "",
    availability: product.availability,
    availableNote: product.availableNote ?? "",
    wholesaleUrl: product.wholesaleUrl ?? "",
    province: product.province ?? "",
    tagRotational: product.tags.includes("rotational"),
    tagFlowThrough: product.tags.includes("flow-through"),
    tagWholesale: product.tags.includes("wholesale"),
    deckId: product.deckId ?? "",
    terpenes: product.terpenes.join(", "),
    effects: product.effects.join(", "),
    talkingPoints: product.talkingPoints.join("\n"),
    status: product.status === "published" ? "published" : "draft",
  };
}

function buildProductPayload(product: AdminProductView | null, value: ProductFormValues) {
  const thcPct = parseNum(value.thcPct);
  const cbdPct = parseNum(value.cbdPct);
  return {
    ...(product ? { productId: product.id } : {}),
    category: value.category as ProductCategory,
    name: value.name.trim(),
    ...(thcPct !== undefined ? { thcPct } : {}),
    ...(cbdPct !== undefined ? { cbdPct } : {}),
    terpenes: parseList(value.terpenes),
    effects: parseList(value.effects),
    talkingPoints: parseList(value.talkingPoints),
    ...(value.format.trim() ? { format: value.format.trim() } : {}),
    ...(value.batch.trim() ? { batch: value.batch.trim() } : {}),
    availability: value.availability as "available" | "limited" | "sold_out" | "upcoming",
    ...(value.availableNote.trim() ? { availableNote: value.availableNote.trim() } : {}),
    tags: [
      value.tagRotational ? "rotational" : null,
      value.tagFlowThrough ? "flow-through" : null,
      value.tagWholesale ? "wholesale" : null,
    ].filter((t): t is string => t != null),
    ...(value.wholesaleUrl.trim() ? { wholesaleUrl: value.wholesaleUrl.trim() } : {}),
    ...(value.province ? { province: value.province } : {}),
    ...(value.deckId.trim() ? { deckId: value.deckId.trim() } : {}),
    status: value.status as "draft" | "published",
  };
}

const productFormOpts = {
  defaultValues: productDefaults(null),
  validators: { onBlur: productSchema },
};

/** What the product IS: name, category, potency, format, and the PK content. */
const ProductFactsFields = withForm({
  ...productFormOpts,
  render: ({ form }) => (
    <>
      <form.AppField name="name">
        {(field) => <field.TextField label="Name" placeholder="Sunset Sherbet" />}
      </form.AppField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="category">
          {(field) => <field.SelectField label="Category" options={CATEGORY_OPTIONS} />}
        </form.AppField>
        <form.AppField name="availability">
          {(field) => <field.SelectField label="Availability" options={AVAILABILITY_OPTIONS} />}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="thcPct">
          {(field) => <field.TextField label="THC %" placeholder="22" />}
        </form.AppField>
        <form.AppField name="cbdPct">
          {(field) => <field.TextField label="CBD %" placeholder="0.5" />}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="format">
          {(field) => <field.TextField label="Format" placeholder="3.5g jar" />}
        </form.AppField>
        <form.AppField name="batch">
          {(field) => <field.TextField label="Batch" placeholder="Lot #" />}
        </form.AppField>
      </div>

      <form.AppField name="terpenes">
        {(field) => (
          <field.TextField
            label="Terpenes"
            placeholder="Myrcene, Limonene, Caryophyllene"
            description="Comma-separated."
          />
        )}
      </form.AppField>

      <form.AppField name="effects">
        {(field) => (
          <field.TextField
            label="Effects"
            placeholder="Relaxing, Euphoric"
            description="Comma-separated."
          />
        )}
      </form.AppField>

      <form.AppField name="talkingPoints">
        {(field) => (
          <field.TextareaField
            label="Talking points"
            placeholder={"One point per line"}
            rows={3}
            description="One per line — these become the bullet list on the detail sheet."
          />
        )}
      </form.AppField>

      <form.AppField name="availableNote">
        {(field) => <field.TextField label="Availability note" placeholder="In stores Friday" />}
      </form.AppField>
    </>
  ),
});

/** How the product SHIPS: tags, provincial wholesale, PK-deck link, publish status. */
const ProductDistributionFields = withForm({
  ...productFormOpts,
  render: ({ form }) => (
    <>
      {/* Cross-cutting descriptor tags — chipped on the budtender card/detail;
          "Rotational" also drives the scroll-callout. */}
      <fieldset className="space-y-2 rounded-sm border border-border p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tags
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <form.AppField name="tagRotational">
            {(field) => <field.SwitchField label="Rotational" />}
          </form.AppField>
          <form.AppField name="tagFlowThrough">
            {(field) => <field.SwitchField label="Flow-through" />}
          </form.AppField>
          <form.AppField name="tagWholesale">
            {(field) => <field.SwitchField label="Wholesale" />}
          </form.AppField>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="province">
          {(field) => (
            <field.SelectField
              label="Province"
              options={PROVINCE_OPTIONS}
              description="For the provincial-wholesale context."
            />
          )}
        </form.AppField>
        <form.AppField name="wholesaleUrl">
          {(field) => (
            <field.TextField
              label="Provincial wholesale link"
              placeholder="https://ocs.ca/…"
              description="OCS / SQDC / provincial listing URL."
            />
          )}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="deckId">
          {(field) => (
            <field.TextField
              label="PK deck id"
              placeholder="Optional"
              description="Links the “Full PK →” jump."
            />
          )}
        </form.AppField>
        <form.AppField name="status">
          {(field) => <field.SelectField label="Status" options={STATUS_OPTIONS} />}
        </form.AppField>
      </div>
    </>
  ),
});

function ProductDialog({
  product,
  onClose,
  onSaved,
}: {
  product: AdminProductView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: productDefaults(product),
    validators: { onBlur: productSchema },
    onSubmit: ({ value }) =>
      save(() => upsertProduct({ data: buildProductPayload(product, value) })),
  });

  return (
    <FormDialog
      form={form}
      title={product ? "Edit product" : "New product"}
      description="Potency, terpenes, effects, and talking points show on the budtender Drop Sheet."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto sm:max-w-lg"
    >
      <ProductFactsFields form={form} />
      <ProductDistributionFields form={form} />
    </FormDialog>
  );
}

// ─── timed drop ───────────────────────────────────────────────────────────────

const dropSchema = type({
  headline: "string",
  dropsAt: "string >= 1",
  endsAt: "string",
  isLimited: "boolean",
});

function DropDialog({
  product,
  onClose,
  onSaved,
}: {
  product: AdminProductView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, setSaveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      headline: "",
      dropsAt: "",
      endsAt: "",
      isLimited: true,
    },
    validators: { onBlur: dropSchema },
    onSubmit: async ({ value }) => {
      const dropsAt = parseDateTime(value.dropsAt);
      if (dropsAt == null) {
        setSaveError("Pick a valid start date/time.");
        return;
      }
      const endsAt = parseDateTime(value.endsAt);
      await save(() =>
        upsertDrop({
          data: {
            productId: product.id,
            ...(value.headline.trim() ? { headline: value.headline.trim() } : {}),
            dropsAt,
            ...(endsAt != null ? { endsAt } : {}),
            isLimited: value.isLimited,
          },
        }),
      );
    },
  });

  return (
    <FormDialog
      form={form}
      title={`Open a drop — ${product.name}`}
      description="During the window, this product is flagged “New drop” on the Drop Sheet."
      onClose={onClose}
      error={saveError}
      submitLabel="Open drop"
      contentClassName="max-h-[90vh] overflow-auto"
    >
      <form.AppField name="headline">
        {(field) => <field.TextField label="Headline" placeholder="Friday drop" />}
      </form.AppField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="dropsAt">
          {(field) => (
            <field.TextField label="Drops at" type="text" placeholder="YYYY-MM-DDThh:mm" />
          )}
        </form.AppField>
        <form.AppField name="endsAt">
          {(field) => <field.TextField label="Ends at" type="text" placeholder="Optional" />}
        </form.AppField>
      </div>

      <form.AppField name="isLimited">
        {(field) => (
          <field.SwitchField
            label="Limited release"
            description="Marks the drop as a limited/scarce release."
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}
