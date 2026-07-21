import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { isValidVersion } from "@si/contracts";
import type { ProductDraftDTO, ProductMediaDTO, ProductVariantDTO } from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Textarea } from "@si/ui/components/textarea";
import { Badge } from "@si/ui/components/badge";
import { toast } from "@si/ui/components/sonner";
import { cn } from "@si/ui/lib/utils";
import { Section } from "@/components/section";
import { PageHeader } from "@/components/page-header";
import { SplitLayout } from "@/components/split-layout";
import { DeletionDialog } from "@/components/deletion-dialog";
import {
  adjustStock,
  deleteProduct,
  deleteProductMedia,
  deleteProductRelease,
  deleteVariant,
  getProduct,
  planProductDeletion,
  planProductMediaDeletion,
  planProductReleaseDeletion,
  planVariantDeletion,
  publishProduct,
  putVariant,
  saveProductDraft,
  setProductStatus,
} from "@/lib/products.functions";
import { formatDate } from "@/lib/format";

// Friendly copy for every typed domain error the StoreOperator mutations return.
const MESSAGES: Record<string, string> = {
  not_found: "This product no longer exists — reload the list.",
  revision_conflict: "The draft changed since you loaded it. Reload and reapply your edit.",
  slug_taken: "That slug is already in use.",
  invalid_price: "Enter a price of $0.00 or more.",
  invalid_version: "Enter a version like 1.0.0.",
  version_exists: "That version was already published.",
  missing_media: "Add at least one image before publishing.",
  missing_variant: "Add at least one variant before publishing.",
  sku_taken: "That SKU is already used by another variant.",
  size_taken: "That size already exists on this product.",
  invalid_stock: "Stock must be a whole number of 0 or more.",
  negative_stock: "That adjustment would drop stock below zero.",
  no_release: "Publish a version before changing the live status.",
  invalid_file: "Choose an image file to upload.",
  upload_failed: "Upload failed — try again.",
};

// Every failed mutation surfaces as a toast; typed codes get friendly copy.
function toastError(code: string): void {
  toast.error(MESSAGES[code] ?? code);
}

// Mono uppercase field label — the console form grammar (mockup 12).
const FIELD_LABEL = "text-muted-foreground font-mono text-[10px] uppercase tracking-wider";

type Detail = {
  draft: ProductDraftDTO;
  releases: Array<{ id: string; version: string; publishedAt: number }>;
  variants: ProductVariantDTO[];
  media: ProductMediaDTO[];
};

export const Route = createFileRoute("/objects/$productId")({
  loader: ({ params }) => getProduct({ data: { productId: params.productId } }),
  component: ProductDetail,
});

function ProductDetail() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
        <BackLink />
        <Card variant="soft" className="p-10 text-center">
          <p className="text-foreground font-mono text-sm">Product not found.</p>
          <p className="text-muted-foreground mt-1 text-xs">It may have been deleted.</p>
        </Card>
      </div>
    );
  }
  return <ProductView data={result.value} />;
}

function ProductView({ data }: { data: Detail }) {
  const router = useRouter();
  const navigate = useNavigate();
  const onDone = () => router.invalidate();
  const { draft } = data;

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        eyebrow={<BackLink />}
        title={
          <span className="font-display block text-3xl font-semibold uppercase tracking-tight sm:text-4xl">
            {draft.title}
          </span>
        }
        subtitle={
          <span className="font-mono text-xs">
            {draft.slug} · rev {draft.revision} · updated {formatDate(draft.updatedAt)}
          </span>
        }
        actions={<StatusControl draft={draft} onDone={onDone} />}
      />

      <SplitLayout
        main={
          <>
            <DraftEditor
              key={`${draft.productId}:${draft.revision}`}
              draft={draft}
              onDone={onDone}
            />
            <VariantsSection productId={draft.productId} variants={data.variants} onDone={onDone} />
          </>
        }
        rail={
          <>
            <MediaSection productId={draft.productId} media={data.media} onDone={onDone} />
            <PublishSection draft={draft} onDone={onDone} />
            <ReleasesSection
              productId={draft.productId}
              releases={data.releases}
              activeVersion={draft.activeVersion}
              onDone={onDone}
            />
            <DangerSection draft={draft} onDeleted={() => void navigate({ to: "/objects" })} />
          </>
        }
      />
    </div>
  );
}

// ── Live status control — compact segmented control (needs a release) ──────────
const STATUS_ACTIONS = [
  { status: "active", label: "Active" },
  { status: "unavailable", label: "Unavailable" },
  { status: "archived", label: "Archived" },
] as const;

function StatusControl({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function set(status: (typeof STATUS_ACTIONS)[number]["status"]): Promise<void> {
    setBusy(true);
    try {
      const res = await setProductStatus({
        data: { commandId: crypto.randomUUID(), productId: draft.productId, status },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(`Status set to ${status}.`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className={cn(FIELD_LABEL, "hidden sm:inline")}>Status</span>
      <div className="border-border-strong inline-flex overflow-hidden rounded-sm border">
        {STATUS_ACTIONS.map((a, i) => {
          const active = draft.status === a.status;
          return (
            <button
              key={a.status}
              type="button"
              disabled={busy || active}
              onClick={() => void set(a.status)}
              className={cn(
                "px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors",
                i > 0 && "border-border-strong border-l",
                active
                  ? "bg-inverse text-inverse-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-sunken disabled:opacity-50",
              )}
            >
              {a.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Draft copy/price editor (optimistic concurrency via expectedRevision) ──────
function DraftEditor({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [price, setPrice] = useState((draft.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(draft.descriptionMarkdown ?? "");
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) {
      toastError("invalid_price");
      return;
    }
    setBusy(true);
    try {
      const res = await saveProductDraft({
        data: {
          commandId: crypto.randomUUID(),
          productId: draft.productId,
          expectedRevision: draft.revision,
          title: title.trim(),
          descriptionMarkdown: description.trim() ? description : null,
          priceCents: Math.round(dollars * 100),
        },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(`Saved. Draft is now rev ${draft.revision + 1}.`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Draft"
      actions={
        <Button size="sm" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save draft"}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="title" className={FIELD_LABEL}>
            Title
          </Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="slug" className={FIELD_LABEL}>
              Slug
            </Label>
            <Input id="slug" value={draft.slug} readOnly disabled />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="price" className={FIELD_LABEL}>
              Price (CAD)
            </Label>
            <Input
              id="price"
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="description" className={FIELD_LABEL}>
            Description (Markdown)
          </Label>
          <Textarea
            id="description"
            rows={7}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Long-form product copy…"
          />
        </div>
      </form>
    </Section>
  );
}

// ── Variants: add/edit (putVariant) + stock adjustment (adjustStock) ───────────
function VariantsSection({
  productId,
  variants,
  onDone,
}: {
  productId: string;
  variants: ProductVariantDTO[];
  onDone: () => void;
}) {
  const [variantId, setVariantId] = useState<string | undefined>(undefined);
  const [size, setSize] = useState("");
  const [sku, setSku] = useState("");
  const [stock, setStock] = useState("0");
  const [busy, setBusy] = useState(false);

  function reset(): void {
    setVariantId(undefined);
    setSize("");
    setSku("");
    setStock("0");
  }

  function edit(v: ProductVariantDTO): void {
    setVariantId(v.id);
    setSize(v.size);
    setSku(v.sku);
    setStock(String(v.stock));
  }

  async function submit(): Promise<void> {
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      toastError("invalid_stock");
      return;
    }
    setBusy(true);
    try {
      const res = await putVariant({
        data: {
          commandId: crypto.randomUUID(),
          productId,
          variantId,
          size: size.trim(),
          sku: sku.trim(),
          stock: stockNum,
        },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(variantId ? "Variant saved." : "Variant added.");
      reset();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Variants">
      {variants.length === 0 ? (
        <p className="text-muted-foreground mb-4 font-mono text-xs">
          No variants yet. Publishing requires at least one.
        </p>
      ) : (
        <div className="border-border mb-4 overflow-hidden rounded-sm border">
          <div className="bg-surface-sunken border-border text-muted-foreground grid grid-cols-[1fr_1.5fr_auto] items-center gap-3 border-b px-3 py-2 font-mono text-[10px] uppercase tracking-wider">
            <span>Size</span>
            <span>SKU</span>
            <span className="text-right">Stock</span>
          </div>
          {variants.map((v) => (
            <VariantRow
              key={v.id}
              productId={productId}
              variant={v}
              onEdit={() => edit(v)}
              onDone={onDone}
            />
          ))}
        </div>
      )}

      <form
        className="border-border grid gap-3 rounded-sm border border-dashed p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className={FIELD_LABEL}>{variantId ? "Edit variant" : "Add variant"}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="v-size" className={FIELD_LABEL}>
              Size
            </Label>
            <Input id="v-size" value={size} onChange={(e) => setSize(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-sku" className={FIELD_LABEL}>
              SKU
            </Label>
            <Input id="v-sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-stock" className={FIELD_LABEL}>
              Stock
            </Label>
            <Input
              id="v-stock"
              type="number"
              min="0"
              step="1"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy || !size.trim() || !sku.trim()}>
            {variantId ? "Save variant" : "Add variant"}
          </Button>
          {variantId && (
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              New instead
            </Button>
          )}
        </div>
      </form>
    </Section>
  );
}

function VariantRow({
  productId,
  variant,
  onEdit,
  onDone,
}: {
  productId: string;
  variant: ProductVariantDTO;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function adjust(): Promise<void> {
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      toastError("invalid_stock");
      return;
    }
    setBusy(true);
    try {
      const res = await adjustStock({
        data: {
          commandId: crypto.randomUUID(),
          variantId: variant.id,
          delta: d,
          reason: reason.trim() || "manual adjustment",
        },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(`Stock adjusted by ${d > 0 ? "+" : ""}${d}.`);
      setDelta("");
      setReason("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border grid gap-2 border-b p-3 last:border-b-0">
      <div className="grid grid-cols-[1fr_1.5fr_auto] items-center gap-3">
        <span className="text-foreground text-sm font-semibold">{variant.size}</span>
        <span className="text-muted-foreground truncate font-mono text-xs">{variant.sku}</span>
        <div className="flex items-center gap-2">
          <Badge variant={variant.stock > 0 ? "secondary" : "warning"}>
            {variant.stock} in stock
          </Badge>
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            className="text-destructive"
            onClick={() => setDeleting(true)}
          >
            Delete
          </Button>
        </div>
      </div>
      <DeletionDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete variant ${variant.size}`}
        confirmPhrase={variant.sku}
        plan={() => planVariantDeletion({ data: { productId, variantId: variant.id } })}
        confirm={(input) =>
          deleteVariant({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={() => {
          setDeleting(false);
          onDone();
        }}
      />
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void adjust();
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`d-${variant.id}`} className={FIELD_LABEL}>
            Δ stock
          </Label>
          <Input
            id={`d-${variant.id}`}
            type="number"
            step="1"
            className="h-9 w-24"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="+10 / -3"
          />
        </div>
        <div className="grid flex-1 gap-1">
          <Label htmlFor={`r-${variant.id}`} className={FIELD_LABEL}>
            Reason
          </Label>
          <Input
            id={`r-${variant.id}`}
            className="h-9"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="restock, damage, …"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !delta}>
          Apply
        </Button>
      </form>
    </div>
  );
}

// ── Media: same-origin upload to the T19 route + uploaded-media list ───────────
const MEDIA_ROLES = ["cover", "gallery", "evidence"] as const;

function MediaSection({
  productId,
  media,
  onDone,
}: {
  productId: string;
  media: ProductMediaDTO[];
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [role, setRole] = useState<(typeof MEDIA_ROLES)[number]>("gallery");
  const [busy, setBusy] = useState(false);

  async function upload(): Promise<void> {
    if (!file) {
      toastError("invalid_file");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("alt", alt);
      fd.set("role", role);
      fd.set("commandId", crypto.randomUUID());
      // Same-origin fetch to the Access-protected T19 route (no CORS): Operator
      // serves this endpoint itself. Success is 201; a body carries {error}.
      const res = await fetch(`/_operator/media/store/products/${productId}`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toastError(body.error ?? "upload_failed");
        return;
      }
      toast.success("Image uploaded.");
      setFile(null);
      setAlt("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Media">
      {media.length > 0 && (
        <div className="mb-4 grid gap-2">
          {media.map((m) => (
            <MediaRow key={m.id} productId={productId} media={m} onDone={onDone} />
          ))}
          <p className="text-muted-foreground/70 font-mono text-[10px]">
            Image previews resolve once the product is published (draft media is not public).
          </p>
        </div>
      )}

      <form
        className="border-border grid gap-3 rounded-sm border border-dashed p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void upload();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="m-file" className={FIELD_LABEL}>
            Image file
          </Label>
          <Input
            id="m-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="m-alt" className={FIELD_LABEL}>
              Alt text
            </Label>
            <Input id="m-alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-role" className={FIELD_LABEL}>
              Role
            </Label>
            <select
              id="m-role"
              value={role}
              onChange={(e) => setRole(e.target.value as (typeof MEDIA_ROLES)[number])}
              className="border-border-strong bg-surface-raised h-10 rounded-sm border-2 px-3 text-sm"
            >
              {MEDIA_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <Button type="submit" size="sm" disabled={busy || !file}>
            {busy ? "Uploading…" : "Upload image"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function MediaRow({
  productId,
  media,
  onDone,
}: {
  productId: string;
  media: ProductMediaDTO;
  onDone: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="border-border flex flex-wrap items-center gap-3 rounded-sm border p-3 text-sm">
      <Badge variant="outline" className="font-mono text-[10px] uppercase">
        {media.role}
      </Badge>
      <span className="text-foreground flex-1 truncate">{media.alt || "—"}</span>
      <span className="text-muted-foreground font-mono text-xs">
        {media.contentType} · {(media.size / 1024).toFixed(0)} KB
      </span>
      <Badge variant={media.state === "ready" ? "success" : "warning"}>{media.state}</Badge>
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        onClick={() => setDeleting(true)}
      >
        Delete
      </Button>
      <DeletionDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete image"
        confirmPhrase={media.id}
        plan={() => planProductMediaDeletion({ data: { productId, mediaId: media.id } })}
        confirm={(input) =>
          deleteProductMedia({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={() => {
          setDeleting(false);
          onDone();
        }}
      />
    </div>
  );
}

// ── Publish (version-gated immutable release) ──────────────────────────────────
function PublishSection({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);

  const semverOk = version.trim() === "" || isValidVersion(version.trim());

  async function publish(): Promise<void> {
    const v = version.trim();
    if (!isValidVersion(v)) {
      toastError("invalid_version");
      return;
    }
    setBusy(true);
    try {
      const res = await publishProduct({
        data: {
          commandId: crypto.randomUUID(),
          productId: draft.productId,
          expectedRevision: draft.revision,
          version: v,
        },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success(`Published ${res.value.version}.`);
      setVersion("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Publish">
      <p className="text-muted-foreground mb-3 font-mono text-xs">
        Freezes the current draft into an immutable release. Requires at least one variant and one
        image.
      </p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="version" className={FIELD_LABEL}>
            Version (SemVer)
          </Label>
          <Input
            id="version"
            className="w-40"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
            aria-invalid={!semverOk}
          />
        </div>
        <Button type="submit" disabled={busy || !isValidVersion(version.trim())}>
          {busy ? "Publishing…" : "Publish release"}
        </Button>
      </form>
      {!semverOk && (
        <p className="text-destructive mt-2 font-mono text-xs">Use a MAJOR.MINOR.PATCH version.</p>
      )}
    </Section>
  );
}

// ── Releases + per-release deletion (shared DeletionDialog) ─────────────────────
function ReleasesSection({
  productId,
  releases,
  activeVersion,
  onDone,
}: {
  productId: string;
  releases: Detail["releases"];
  activeVersion: string | null;
  onDone: () => void;
}) {
  const [target, setTarget] = useState<{ id: string; version: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Deleting the live release may promote one of the other retained releases in
  // its place (contract `replacementReleaseId`); "" means leave nothing live.
  const [replacementId, setReplacementId] = useState("");

  if (releases.length === 0) return null;

  const others = target ? releases.filter((r) => r.id !== target.id) : [];
  const targetIsLive = target != null && target.version === activeVersion;
  // The live release with alternatives gets a replacement-picker step first; every
  // other release goes straight to the typed-confirmation dialog.
  const pickingReplacement = targetIsLive && others.length > 0 && !confirmOpen;

  function startDelete(r: { id: string; version: string }): void {
    setReplacementId("");
    setTarget(r);
    setConfirmOpen(!(r.version === activeVersion && releases.length > 1));
  }

  function reset(): void {
    setTarget(null);
    setConfirmOpen(false);
    setReplacementId("");
  }

  return (
    <Section title="Releases">
      <div className="grid gap-1.5 font-mono text-sm">
        {releases.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3">
            <span className="text-foreground">
              {r.version}
              {r.version === activeVersion && (
                <Badge variant="success" className="ml-2 text-[10px]">
                  live
                </Badge>
              )}
            </span>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">{formatDate(r.publishedAt)}</span>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                onClick={() => startDelete({ id: r.id, version: r.version })}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>

      {pickingReplacement && target && (
        <div className="border-border mt-4 grid gap-2 rounded-sm border border-dashed p-4">
          <p className="text-warning font-mono text-xs">
            {target.version} is live. Choose which release goes live once it's deleted.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="replacement" className={FIELD_LABEL}>
              Promote in place of {target.version}
            </Label>
            <select
              id="replacement"
              value={replacementId}
              onChange={(e) => setReplacementId(e.target.value)}
              className="border-border-strong bg-surface-raised h-10 rounded-sm border-2 px-3 text-sm"
            >
              <option value="">Leave nothing live</option>
              {others.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.version}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => setConfirmOpen(true)}>
              Continue
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {target && (
        <DeletionDialog
          open={confirmOpen}
          onOpenChange={(o) => {
            if (!o) reset();
          }}
          title={`Delete release ${target.version}`}
          confirmPhrase={target.version}
          plan={async () => {
            const res = await planProductReleaseDeletion({
              data: {
                productId,
                releaseId: target.id,
                replacementReleaseId: replacementId || null,
              },
            });
            // `invalid_replacement` isn't a DeletionError — give it plain copy so
            // the dialog's plan-error alert reads sensibly.
            if (!res.ok && res.error === "invalid_replacement") {
              return { ok: false, error: "The chosen replacement release is no longer valid." };
            }
            return res;
          }}
          confirm={(input) =>
            deleteProductRelease({
              data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
            })
          }
          onDeleted={() => {
            reset();
            onDone();
          }}
        />
      )}
    </Section>
  );
}

// ── Danger zone: hard-delete the product and every release ─────────────────────
function DangerSection({ draft, onDeleted }: { draft: ProductDraftDTO; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Danger zone" tone="soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground font-mono text-xs">
          Permanently delete this product and every release, variant, and image.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete product
        </Button>
      </div>
      <DeletionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${draft.title}”`}
        confirmPhrase={draft.slug}
        plan={() => planProductDeletion({ data: { productId: draft.productId } })}
        confirm={(input) =>
          deleteProduct({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={onDeleted}
      />
    </Section>
  );
}

// ── Small shared presentation bits ─────────────────────────────────────────────
function BackLink() {
  return (
    <Link
      to="/objects"
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-[10px] uppercase tracking-wider"
    >
      ← all objects
    </Link>
  );
}
