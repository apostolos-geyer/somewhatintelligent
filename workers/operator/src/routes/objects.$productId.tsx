import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { isValidVersion } from "@si/contracts";
import type { ProductDraftDTO, ProductMediaDTO, ProductVariantDTO } from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Textarea } from "@si/ui/components/textarea";
import { Badge } from "@si/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { ProductStatusBadge } from "@/components/product-status-badge";
import {
  adjustStock,
  getProduct,
  publishProduct,
  putVariant,
  saveProductDraft,
  setProductStatus,
} from "@/lib/products.functions";
import { formatCents, formatDate } from "@/lib/format";

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
};

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
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card variant="soft" className="mt-4 p-10 text-center">
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
  const onDone = () => router.invalidate();
  const { draft } = data;

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <div className="mb-6 mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">{draft.title}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {draft.slug} · rev {draft.revision} · updated {formatDate(draft.updatedAt)}
          </p>
        </div>
        <ProductStatusBadge status={draft.status} />
      </div>

      <DraftEditor key={`${draft.productId}:${draft.revision}`} draft={draft} onDone={onDone} />
      <VariantsSection productId={draft.productId} variants={data.variants} onDone={onDone} />
      <MediaSection productId={draft.productId} media={data.media} onDone={onDone} />
      <PublishSection draft={draft} onDone={onDone} />
      <StatusSection draft={draft} onDone={onDone} />
      <ReleasesSection releases={data.releases} activeVersion={draft.activeVersion} />
    </div>
  );
}

// ── Draft copy/price editor (optimistic concurrency via expectedRevision) ──────
function DraftEditor({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [title, setTitle] = useState(draft.title);
  const [price, setPrice] = useState((draft.priceCents / 100).toFixed(2));
  const [description, setDescription] = useState(draft.descriptionMarkdown ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setSaved(false);
    const dollars = Number(price);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("invalid_price");
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
        setError(res.error);
        return;
      }
      setSaved(true);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Draft">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <ErrorAlert code={error} />}
        {saved && !error && (
          <p className="text-success font-mono text-xs">
            Saved. Draft is now rev {draft.revision + 1}.
          </p>
        )}
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="grid gap-2 sm:max-w-40">
          <Label htmlFor="price">Price (CAD)</Label>
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
        <div className="grid gap-2">
          <Label htmlFor="description">Description (Markdown)</Label>
          <Textarea
            id="description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Long-form product copy…"
          />
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save draft"}
          </Button>
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
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setVariantId(undefined);
    setSize("");
    setSku("");
    setStock("0");
    setError(null);
  }

  function edit(v: ProductVariantDTO): void {
    setVariantId(v.id);
    setSize(v.size);
    setSku(v.sku);
    setStock(String(v.stock));
    setError(null);
  }

  async function submit(): Promise<void> {
    setError(null);
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("invalid_stock");
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
        setError(res.error);
        return;
      }
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
        <div className="mb-4 grid gap-2">
          {variants.map((v) => (
            <VariantRow key={v.id} variant={v} onEdit={() => edit(v)} onDone={onDone} />
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
        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
          {variantId ? "Edit variant" : "Add variant"}
        </p>
        {error && <ErrorAlert code={error} />}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="v-size">Size</Label>
            <Input id="v-size" value={size} onChange={(e) => setSize(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-sku">SKU</Label>
            <Input id="v-sku" value={sku} onChange={(e) => setSku(e.target.value)} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="v-stock">Stock</Label>
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
  variant,
  onEdit,
  onDone,
}: {
  variant: ProductVariantDTO;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function adjust(): Promise<void> {
    setError(null);
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) {
      setError("invalid_stock");
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
        setError(res.error);
        return;
      }
      setDelta("");
      setReason("");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-border grid gap-2 rounded-sm border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 text-sm">
          <span className="text-foreground font-semibold">{variant.size}</span>
          <span className="text-muted-foreground font-mono text-xs">{variant.sku}</span>
          <Badge variant={variant.stock > 0 ? "secondary" : "warning"}>
            {variant.stock} in stock
          </Badge>
        </div>
        <Button size="xs" variant="ghost" onClick={onEdit}>
          Edit
        </Button>
      </div>
      {error && <ErrorAlert code={error} />}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void adjust();
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`d-${variant.id}`} className="text-[10px]">
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
          <Label htmlFor={`r-${variant.id}`} className="text-[10px]">
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
  const [error, setError] = useState<string | null>(null);

  async function upload(): Promise<void> {
    setError(null);
    if (!file) {
      setError("invalid_file");
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
        setError(body.error ?? `upload_failed_${res.status}`);
        return;
      }
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
            <div
              key={m.id}
              className="border-border flex flex-wrap items-center gap-3 rounded-sm border p-3 text-sm"
            >
              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                {m.role}
              </Badge>
              <span className="text-foreground flex-1 truncate">{m.alt || "—"}</span>
              <span className="text-muted-foreground font-mono text-xs">
                {m.contentType} · {(m.size / 1024).toFixed(0)} KB
              </span>
              <Badge variant={m.state === "ready" ? "success" : "warning"}>{m.state}</Badge>
            </div>
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
        {error && <ErrorAlert code={error} />}
        <div className="grid gap-1.5">
          <Label htmlFor="m-file">Image file</Label>
          <Input
            id="m-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="m-alt">Alt text</Label>
            <Input id="m-alt" value={alt} onChange={(e) => setAlt(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-role">Role</Label>
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

// ── Publish (version-gated immutable release) ──────────────────────────────────
function PublishSection({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  const semverOk = version.trim() === "" || isValidVersion(version.trim());

  async function publish(): Promise<void> {
    setError(null);
    setPublished(null);
    const v = version.trim();
    if (!isValidVersion(v)) {
      setError("invalid_version");
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
        setError(res.error);
        return;
      }
      setPublished(res.value.version);
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
      {error && <ErrorAlert code={error} />}
      {published && !error && (
        <p className="text-success mb-3 font-mono text-xs">Published {published}.</p>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void publish();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="version">Version (SemVer)</Label>
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

// ── Live status control (needs a release) ──────────────────────────────────────
const STATUS_ACTIONS = [
  { status: "active", label: "Set active" },
  { status: "unavailable", label: "Set unavailable" },
  { status: "archived", label: "Archive" },
] as const;

function StatusSection({ draft, onDone }: { draft: ProductDraftDTO; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(status: (typeof STATUS_ACTIONS)[number]["status"]): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await setProductStatus({
        data: { commandId: crypto.randomUUID(), productId: draft.productId, status },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Status">
      {error && <ErrorAlert code={error} />}
      <div className="flex flex-wrap gap-2">
        {STATUS_ACTIONS.map((a) => (
          <Button
            key={a.status}
            size="sm"
            variant={draft.status === a.status ? "default" : "outline"}
            disabled={busy || draft.status === a.status}
            onClick={() => void set(a.status)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </Section>
  );
}

function ReleasesSection({
  releases,
  activeVersion,
}: {
  releases: Detail["releases"];
  activeVersion: string | null;
}) {
  if (releases.length === 0) return null;
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
            <span className="text-muted-foreground text-xs">{formatDate(r.publishedAt)}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Small shared presentation bits ─────────────────────────────────────────────
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="soft" className="mb-6 p-5">
      <h2 className="text-foreground mb-3 font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function ErrorAlert({ code }: { code: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn't complete that action</AlertTitle>
      <AlertDescription>{MESSAGES[code] ?? code}</AlertDescription>
    </Alert>
  );
}

function BackLink() {
  return (
    <Link
      to="/objects"
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all objects
    </Link>
  );
}
