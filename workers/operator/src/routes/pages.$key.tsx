import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { isValidVersion, validatePageDocument } from "@si/contracts";
import type {
  AboutDocumentV1,
  HomeDocumentV1,
  PageDocumentByKey,
  PageKey,
  PublisherMediaDTO,
  ShopDocumentV1,
  SoftwareDocumentV1,
  WritingDocumentV1,
} from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Textarea } from "@si/ui/components/textarea";
import { toast } from "@si/ui/components/sonner";
import { DeletionDialog } from "@/components/deletion-dialog";
import { PublisherMediaUpload } from "@/components/publisher-media-upload";
import { PreviewPanel } from "@/components/preview-panel";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { SplitLayout } from "@/components/split-layout";
import { EntityPicker, type PickerOption } from "@/components/entity-picker";
import type { PreviewPayload } from "@/lib/preview";
import {
  createPage,
  deletePage,
  getPage,
  planPageDeletion,
  publishPage,
  savePageDraft,
} from "@/lib/pages.functions";
import { getProduct, searchProducts } from "@/lib/products.functions";
import { getSoftware, searchSoftware } from "@/lib/software.functions";
import { getText, searchTextsForFeature } from "@/lib/texts.functions";
import { defaultPageDocument, PAGE_KEYS, PAGE_KEY_LABELS } from "@/lib/page-forms";

// Search/resolve closures a media EntityPicker binds against — search filters the
// page's owned-media list; resolve turns a stored id back into a labeled option.
type PickerSource = {
  search: (query: string) => Promise<PickerOption[]>;
  resolve: (id: string) => Promise<PickerOption | null>;
};

function mediaPickerSource(media: PublisherMediaDTO[]): PickerSource {
  const toOption = (m: PublisherMediaDTO): PickerOption => ({
    id: m.id,
    label: m.alt || "untitled image",
    sublabel: m.role,
    thumbnailHref: m.href,
  });
  return {
    search: (query) => {
      const q = query.trim().toLowerCase();
      const matched =
        q === ""
          ? media
          : media.filter(
              (m) =>
                m.alt.toLowerCase().includes(q) ||
                m.role.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q),
            );
      return Promise.resolve(matched.slice(0, 20).map(toOption));
    },
    resolve: (idValue) => {
      const found = media.find((m) => m.id === idValue);
      return Promise.resolve(found ? toOption(found) : null);
    },
  };
}

// Featured-record picker sources — search returns id/title/slug options; resolve
// turns the document's stored id back into a label via the record's get fn.
const productPickerSource: PickerSource = {
  search: async (query) => {
    const rows = await searchProducts({ data: { query } });
    return rows.map((p) => ({ id: p.productId, label: p.title, sublabel: p.slug }));
  },
  resolve: async (idValue) => {
    const res = await getProduct({ data: { productId: idValue } });
    if (!res.ok) return null;
    return {
      id: res.value.draft.productId,
      label: res.value.draft.title,
      sublabel: res.value.draft.slug,
    };
  },
};

const softwarePickerSource: PickerSource = {
  search: async (query) => {
    const rows = await searchSoftware({ data: { query } });
    return rows.map((s) => ({ id: s.softwareId, label: s.title, sublabel: s.slug }));
  },
  resolve: async (idValue) => {
    const res = await getSoftware({ data: { softwareId: idValue } });
    if (!res.ok) return null;
    return {
      id: res.value.draft.softwareId,
      label: res.value.draft.title,
      sublabel: res.value.draft.slug,
    };
  },
};

const textPickerSource: PickerSource = {
  search: async (query) => {
    const rows = await searchTextsForFeature({ data: { query } });
    return rows.map((t) => ({ id: t.textId, label: t.title, sublabel: t.slug }));
  },
  resolve: async (idValue) => {
    const res = await getText({ data: { textId: idValue } });
    if (!res.ok) return null;
    return {
      id: res.value.draft.textId,
      label: res.value.draft.title,
      sublabel: res.value.draft.slug,
    };
  },
};

const MESSAGES: Record<string, string> = {
  not_found: "This page no longer exists — reload.",
  revision_conflict: "The draft changed since you loaded it. Reload and reapply your edit.",
  invalid_document: "The document has a field the page schema rejects.",
  invalid_version: "Enter a version like 1.0.0.",
  version_exists: "That version was already published.",
  invalid_reference: "A featured record or media reference points at something that doesn't exist.",
  page_exists: "This page was already created — reload.",
};

function isPageKey(value: string): value is PageKey {
  return (PAGE_KEYS as readonly string[]).includes(value);
}

type Loaded =
  | { kind: "invalid" }
  | { kind: "new"; key: PageKey }
  | {
      kind: "existing";
      key: PageKey;
      document: PageDocumentByKey[PageKey];
      revision: number;
      activeVersion: string | null;
      media: PublisherMediaDTO[];
    };

export const Route = createFileRoute("/pages/$key")({
  loader: async ({ params }): Promise<Loaded> => {
    if (!isPageKey(params.key)) return { kind: "invalid" };
    const key = params.key;
    const res = await getPage({ data: { key } });
    if (!res.ok) return { kind: "new", key };
    return {
      kind: "existing",
      key,
      document: res.value.document,
      revision: res.value.revision,
      activeVersion: res.value.activeVersion,
      media: res.value.media,
    };
  },
  component: PageDetail,
});

function PageDetail() {
  const loaded = Route.useLoaderData();
  if (loaded.kind === "invalid") {
    return (
      <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
        <PageHeader eyebrow={<BackLink />} title="Unknown page" />
        <Card variant="soft" className="p-10 text-center">
          <p className="text-foreground font-mono text-sm">This page key isn't recognized.</p>
        </Card>
      </div>
    );
  }
  const initial = loaded.kind === "new" ? defaultPageDocument(loaded.key) : loaded.document;
  const revision = loaded.kind === "existing" ? loaded.revision : 0;
  const activeVersion = loaded.kind === "existing" ? loaded.activeVersion : null;
  const media = loaded.kind === "existing" ? loaded.media : [];
  return (
    <PageEditor
      key={`${loaded.key}:${revision}`}
      pageKey={loaded.key}
      exists={loaded.kind === "existing"}
      initial={initial}
      revision={revision}
      activeVersion={activeVersion}
      initialMedia={media}
    />
  );
}

function PageEditor({
  pageKey,
  exists,
  initial,
  revision: initialRevision,
  activeVersion,
  initialMedia,
}: {
  pageKey: PageKey;
  exists: boolean;
  initial: PageDocumentByKey[PageKey];
  revision: number;
  activeVersion: string | null;
  initialMedia: PublisherMediaDTO[];
}) {
  const router = useRouter();
  const [document, setDocument] = useState(initial);
  const [media, setMedia] = useState(initialMedia);
  const [created, setCreated] = useState(exists);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);

  // Owned-media rows (from getPage, appended to on upload) back the media
  // pickers below; recreated per render, but EntityPicker holds the callbacks in
  // refs so the fresh closures never re-fire its search/resolve effects.
  const mediaSource = mediaPickerSource(media);

  async function save(): Promise<void> {
    const check = validatePageDocument(pageKey, document);
    if (!check.ok) {
      toast.error(MESSAGES.invalid_document, { description: check.message ?? undefined });
      return;
    }
    setBusy(true);
    try {
      if (!created) {
        const res = await createPage({
          data: { commandId: crypto.randomUUID(), key: pageKey, document },
        });
        if (!res.ok) {
          toast.error(MESSAGES[res.error] ?? res.error, { description: res.message ?? undefined });
          return;
        }
        setCreated(true);
        setRevision(res.value.revision);
        toast.success("Page created.");
      } else {
        const res = await savePageDraft({
          data: {
            commandId: crypto.randomUUID(),
            key: pageKey,
            expectedRevision: revision,
            document,
          },
        });
        if (!res.ok) {
          toast.error(MESSAGES[res.error] ?? res.error, { description: res.message ?? undefined });
          return;
        }
        setRevision(res.value.revision);
        toast.success("Draft saved.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        eyebrow={<BackLink />}
        title={`${PAGE_KEY_LABELS[pageKey]} page`}
        subtitle={
          <span className="font-mono text-xs">
            {created ? `rev ${revision}` : "not created yet"}
            {activeVersion ? ` · live ${activeVersion}` : ""}
          </span>
        }
        actions={
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : created ? "Save draft" : "Create page"}
          </Button>
        }
      />

      <SplitLayout
        railWidth="32rem"
        main={
          <>
            <SeoSection
              seo={document.seo}
              media={mediaSource}
              onChange={(seo) => setDocument({ ...document, seo })}
            />
            <ContentSection document={document} media={mediaSource} onChange={setDocument} />

            {created && (
              <PageMediaSection
                pageKey={pageKey}
                onUploaded={(m) => setMedia((prev) => [m, ...prev])}
              />
            )}

            {created && (
              <PublishSection
                pageKey={pageKey}
                revision={revision}
                onDone={() => void router.invalidate()}
              />
            )}
            {created && (
              <DangerSection pageKey={pageKey} onDeleted={() => void router.invalidate()} />
            )}
          </>
        }
        rail={
          <PreviewPanel
            getPayload={(): PreviewPayload => ({ kind: "page", key: pageKey, document })}
          />
        }
      />
    </div>
  );
}

// ── Shared SEO block (present on every page document) ──────────────────────────
function SeoSection({
  seo,
  media,
  onChange,
}: {
  seo: { title: string; description: string; imageMediaId: string | null };
  media: PickerSource;
  onChange: (seo: { title: string; description: string; imageMediaId: string | null }) => void;
}) {
  return (
    <Section title="SEO">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="seo-title">Title</Label>
          <Input
            id="seo-title"
            value={seo.title}
            onChange={(e) => onChange({ ...seo, title: e.target.value })}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="seo-desc">Description</Label>
          <Textarea
            id="seo-desc"
            rows={2}
            value={seo.description}
            onChange={(e) => onChange({ ...seo, description: e.target.value })}
          />
        </div>
        <div className="grid gap-2 sm:max-w-sm">
          <PickerField
            id="seo-image"
            label="OG image"
            source={media}
            valueId={seo.imageMediaId}
            onChange={(imageMediaId) => onChange({ ...seo, imageMediaId })}
            placeholder="search uploaded media"
            minChars={1}
          />
        </div>
      </div>
    </Section>
  );
}

// ── Per-key structured content (faithful to the discriminated union) ───────────
function ContentSection({
  document,
  media,
  onChange,
}: {
  document: PageDocumentByKey[PageKey];
  media: PickerSource;
  onChange: (document: PageDocumentByKey[PageKey]) => void;
}) {
  switch (document.key) {
    case "home":
      return <HomeFields doc={document} media={media} onChange={onChange} />;
    case "about":
      return <AboutFields doc={document} media={media} onChange={onChange} />;
    default:
      return <ListPageFields doc={document} onChange={onChange} />;
  }
}

function ListPageFields({
  doc,
  onChange,
}: {
  doc: ShopDocumentV1 | WritingDocumentV1 | SoftwareDocumentV1;
  onChange: (document: ShopDocumentV1 | WritingDocumentV1 | SoftwareDocumentV1) => void;
}) {
  return (
    <Section title="Content">
      <p className="text-muted-foreground mb-3 font-mono text-[10px] uppercase tracking-wider">
        {doc.eyebrow}
      </p>
      <div className="grid gap-4">
        <Field label="Title" value={doc.title} onChange={(title) => onChange({ ...doc, title })} />
        <FieldArea label="Deck" value={doc.deck} onChange={(deck) => onChange({ ...doc, deck })} />
        <FieldArea
          label="Empty message"
          value={doc.emptyMessage}
          onChange={(emptyMessage) => onChange({ ...doc, emptyMessage })}
        />
      </div>
    </Section>
  );
}

function AboutFields({
  doc,
  media,
  onChange,
}: {
  doc: AboutDocumentV1;
  media: PickerSource;
  onChange: (document: AboutDocumentV1) => void;
}) {
  return (
    <Section title="Content">
      <div className="grid gap-4">
        <Field label="Title" value={doc.title} onChange={(title) => onChange({ ...doc, title })} />
        <FieldArea
          label="Statement"
          rows={4}
          value={doc.statement}
          onChange={(statement) => onChange({ ...doc, statement })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <PickerField
            label="Primary media"
            source={media}
            valueId={doc.primaryMediaId}
            onChange={(primaryMediaId) => onChange({ ...doc, primaryMediaId })}
            placeholder="search uploaded media"
            minChars={1}
          />
          <PickerField
            label="Secondary media"
            source={media}
            valueId={doc.secondaryMediaId}
            onChange={(secondaryMediaId) => onChange({ ...doc, secondaryMediaId })}
            placeholder="search uploaded media"
            minChars={1}
          />
        </div>
        <FieldArea
          label="Lower content"
          rows={5}
          value={doc.lowerContent}
          onChange={(lowerContent) => onChange({ ...doc, lowerContent })}
        />
      </div>
    </Section>
  );
}

function HomeFields({
  doc,
  media,
  onChange,
}: {
  doc: HomeDocumentV1;
  media: PickerSource;
  onChange: (document: HomeDocumentV1) => void;
}) {
  const s = doc.sections;
  return (
    <>
      <Section title="Hero">
        <div className="grid gap-4">
          <FieldArea
            label="Tagline"
            value={doc.tagline}
            onChange={(tagline) => onChange({ ...doc, tagline })}
          />
          <PickerField
            label="Hero media"
            source={media}
            valueId={doc.heroMediaId}
            onChange={(heroMediaId) => onChange({ ...doc, heroMediaId })}
            placeholder="search uploaded media"
            minChars={1}
          />
        </div>
      </Section>

      <Section title="Objects section">
        <div className="grid gap-4">
          <FieldArea
            label="Body"
            value={s.objects.body}
            onChange={(body) =>
              onChange({ ...doc, sections: { ...s, objects: { ...s.objects, body } } })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField
              label="Featured product"
              source={productPickerSource}
              valueId={s.objects.featuredProductId}
              onChange={(featuredProductId) =>
                onChange({
                  ...doc,
                  sections: { ...s, objects: { ...s.objects, featuredProductId } },
                })
              }
              placeholder="search products"
            />
            <Field
              label="Action label"
              value={s.objects.actionLabel}
              onChange={(actionLabel) =>
                onChange({ ...doc, sections: { ...s, objects: { ...s.objects, actionLabel } } })
              }
            />
          </div>
        </div>
      </Section>

      <Section title="Software section">
        <div className="grid gap-4">
          <FieldArea
            label="Body"
            value={s.systems.body}
            onChange={(body) =>
              onChange({ ...doc, sections: { ...s, systems: { ...s.systems, body } } })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField
              label="Featured software"
              source={softwarePickerSource}
              valueId={s.systems.featuredSoftwareId}
              onChange={(featuredSoftwareId) =>
                onChange({
                  ...doc,
                  sections: { ...s, systems: { ...s.systems, featuredSoftwareId } },
                })
              }
              placeholder="search software"
            />
            <Field
              label="Action label"
              value={s.systems.actionLabel}
              onChange={(actionLabel) =>
                onChange({ ...doc, sections: { ...s, systems: { ...s.systems, actionLabel } } })
              }
            />
          </div>
        </div>
      </Section>

      <Section title="Texts section">
        <div className="grid gap-4">
          <FieldArea
            label="Body"
            value={s.texts.body}
            onChange={(body) =>
              onChange({ ...doc, sections: { ...s, texts: { ...s.texts, body } } })
            }
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <PickerField
              label="Featured text"
              source={textPickerSource}
              valueId={s.texts.featuredTextId}
              onChange={(featuredTextId) =>
                onChange({
                  ...doc,
                  sections: { ...s, texts: { ...s.texts, featuredTextId } },
                })
              }
              placeholder="search texts"
            />
            <Field
              label="Action label"
              value={s.texts.actionLabel}
              onChange={(actionLabel) =>
                onChange({ ...doc, sections: { ...s, texts: { ...s.texts, actionLabel } } })
              }
            />
          </div>
        </div>
      </Section>

      <Section title="About section">
        <div className="grid gap-4">
          <FieldArea
            label="Body"
            value={s.about.body}
            onChange={(body) =>
              onChange({ ...doc, sections: { ...s, about: { ...s.about, body } } })
            }
          />
          <Field
            label="Action label"
            value={s.about.actionLabel}
            onChange={(actionLabel) =>
              onChange({ ...doc, sections: { ...s, about: { ...s.about, actionLabel } } })
            }
          />
        </div>
      </Section>
    </>
  );
}

// ── Page media ─────────────────────────────────────────────────────────────────
// Page media is referenced by id inside the document (RFC-0001 D10). Uploads flow
// straight into the editor's owned-media list, so the media pickers above (hero,
// SEO image, primary/secondary) pick them by thumbnail + alt without any id copy.
function PageMediaSection({
  pageKey,
  onUploaded,
}: {
  pageKey: PageKey;
  onUploaded: (media: PublisherMediaDTO) => void;
}) {
  return (
    <Section title="Media">
      <p className="text-muted-foreground mb-3 font-mono text-xs">
        Upload an image, then select it in a media field above (hero, SEO image, primary…).
      </p>
      <PublisherMediaUpload ownerType="page" ownerId={pageKey} onUploaded={onUploaded} />
    </Section>
  );
}

// ── Publish + delete ───────────────────────────────────────────────────────────
function PublishSection({
  pageKey,
  revision,
  onDone,
}: {
  pageKey: PageKey;
  revision: number;
  onDone: () => void;
}) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);

  const semverOk = version.trim() === "" || isValidVersion(version.trim());

  async function publish(): Promise<void> {
    const v = version.trim();
    if (!isValidVersion(v)) {
      toast.error(MESSAGES.invalid_version);
      return;
    }
    setBusy(true);
    try {
      const res = await publishPage({
        data: {
          commandId: crypto.randomUUID(),
          key: pageKey,
          expectedRevision: revision,
          version: v,
        },
      });
      if (!res.ok) {
        toast.error(MESSAGES[res.error] ?? res.error, { description: res.message ?? undefined });
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
        Freezes the current draft into an immutable versioned release. References are validated at
        publish.
      </p>
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
    </Section>
  );
}

function DangerSection({ pageKey, onDeleted }: { pageKey: PageKey; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section
      title="Danger zone"
      tone="soft"
      actions={
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete page
        </Button>
      }
    >
      <p className="text-muted-foreground font-mono text-xs">
        Permanently delete this page document and every release.
      </p>
      <DeletionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete the ${PAGE_KEY_LABELS[pageKey]} page`}
        confirmPhrase={pageKey}
        plan={() => planPageDeletion({ data: { key: pageKey } })}
        confirm={(input) =>
          deletePage({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={onDeleted}
      />
    </Section>
  );
}

// ── Small shared bits ──────────────────────────────────────────────────────────
function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

// Labeled searchable id picker — the reskinned replacement for the raw-id Inputs
// (RFC-0001 wave-1 UX); submits the chosen id and clears to null.
function PickerField({
  label,
  source,
  valueId,
  onChange,
  placeholder,
  minChars,
  id,
}: {
  label: string;
  source: PickerSource;
  valueId: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  minChars?: number;
  id?: string;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <EntityPicker
        id={id}
        valueId={valueId}
        onChange={onChange}
        search={source.search}
        resolve={source.resolve}
        placeholder={placeholder}
        minChars={minChars}
      />
    </div>
  );
}

function FieldArea({
  label,
  value,
  rows = 2,
  onChange,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/pages" className="hover:text-foreground transition-colors">
      ← all pages
    </Link>
  );
}
