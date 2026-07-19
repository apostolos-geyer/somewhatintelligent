import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { isValidVersion, validatePageDocument } from "@si/contracts";
import type {
  AboutDocumentV1,
  HomeDocumentV1,
  PageDocumentByKey,
  PageKey,
  ShopDocumentV1,
  SoftwareDocumentV1,
  WritingDocumentV1,
} from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Textarea } from "@si/ui/components/textarea";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { DeletionDialog } from "@/components/deletion-dialog";
import {
  createPage,
  deletePage,
  getPage,
  planPageDeletion,
  publishPage,
  savePageDraft,
} from "@/lib/pages.functions";
import { defaultPageDocument, PAGE_KEYS, PAGE_KEY_LABELS } from "@/lib/page-forms";

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
    };
  },
  component: PageDetail,
});

function PageDetail() {
  const loaded = Route.useLoaderData();
  if (loaded.kind === "invalid") {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card variant="soft" className="mt-4 p-10 text-center">
          <p className="text-foreground font-mono text-sm">Unknown page.</p>
        </Card>
      </div>
    );
  }
  const initial = loaded.kind === "new" ? defaultPageDocument(loaded.key) : loaded.document;
  const revision = loaded.kind === "existing" ? loaded.revision : 0;
  const activeVersion = loaded.kind === "existing" ? loaded.activeVersion : null;
  return (
    <PageEditor
      key={`${loaded.key}:${revision}`}
      pageKey={loaded.key}
      exists={loaded.kind === "existing"}
      initial={initial}
      revision={revision}
      activeVersion={activeVersion}
    />
  );
}

function PageEditor({
  pageKey,
  exists,
  initial,
  revision: initialRevision,
  activeVersion,
}: {
  pageKey: PageKey;
  exists: boolean;
  initial: PageDocumentByKey[PageKey];
  revision: number;
  activeVersion: string | null;
}) {
  const router = useRouter();
  const [document, setDocument] = useState(initial);
  const [created, setCreated] = useState(exists);
  const [revision, setRevision] = useState(initialRevision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setMessage(null);
    setSaved(false);
    const check = validatePageDocument(pageKey, document);
    if (!check.ok) {
      setError("invalid_document");
      setMessage(check.message ?? null);
      return;
    }
    setBusy(true);
    try {
      if (!created) {
        const res = await createPage({
          data: { commandId: crypto.randomUUID(), key: pageKey, document },
        });
        if (!res.ok) {
          setError(res.error);
          setMessage(res.message ?? null);
          return;
        }
        setCreated(true);
        setRevision(res.value.revision);
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
          setError(res.error);
          setMessage(res.message ?? null);
          return;
        }
        setRevision(res.value.revision);
      }
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <div className="mb-6 mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">
            {PAGE_KEY_LABELS[pageKey]} page
          </h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {created ? `rev ${revision}` : "not created yet"}
            {activeVersion ? ` · live ${activeVersion}` : ""}
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Couldn't save</AlertTitle>
          <AlertDescription>
            {MESSAGES[error] ?? error}
            {message && <span className="mt-1 block font-mono text-xs opacity-80">{message}</span>}
          </AlertDescription>
        </Alert>
      )}
      {saved && !error && <p className="text-success mb-6 font-mono text-xs">Saved.</p>}

      <SeoSection seo={document.seo} onChange={(seo) => setDocument({ ...document, seo })} />
      <ContentSection document={document} onChange={setDocument} />

      <Section title="Draft">
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : created ? "Save draft" : "Create page"}
        </Button>
      </Section>

      {created && (
        <PublishSection
          pageKey={pageKey}
          revision={revision}
          onDone={() => void router.invalidate()}
        />
      )}
      {created && <DangerSection pageKey={pageKey} onDeleted={() => void router.invalidate()} />}
    </div>
  );
}

// ── Shared SEO block (present on every page document) ──────────────────────────
function SeoSection({
  seo,
  onChange,
}: {
  seo: { title: string; description: string; imageMediaId: string | null };
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
          <Label htmlFor="seo-image">OG image media ID</Label>
          <Input
            id="seo-image"
            value={seo.imageMediaId ?? ""}
            onChange={(e) => onChange({ ...seo, imageMediaId: e.target.value.trim() || null })}
            placeholder="media id (optional)"
          />
        </div>
      </div>
    </Section>
  );
}

// ── Per-key structured content (faithful to the discriminated union) ───────────
function ContentSection({
  document,
  onChange,
}: {
  document: PageDocumentByKey[PageKey];
  onChange: (document: PageDocumentByKey[PageKey]) => void;
}) {
  switch (document.key) {
    case "home":
      return <HomeFields doc={document} onChange={onChange} />;
    case "about":
      return <AboutFields doc={document} onChange={onChange} />;
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
  onChange,
}: {
  doc: AboutDocumentV1;
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
          <Field
            label="Primary media ID"
            value={doc.primaryMediaId ?? ""}
            onChange={(v) => onChange({ ...doc, primaryMediaId: v.trim() || null })}
          />
          <Field
            label="Secondary media ID"
            value={doc.secondaryMediaId ?? ""}
            onChange={(v) => onChange({ ...doc, secondaryMediaId: v.trim() || null })}
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
  onChange,
}: {
  doc: HomeDocumentV1;
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
          <Field
            label="Hero media ID"
            value={doc.heroMediaId ?? ""}
            onChange={(v) => onChange({ ...doc, heroMediaId: v.trim() || null })}
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
            <Field
              label="Featured product ID"
              value={s.objects.featuredProductId ?? ""}
              onChange={(v) =>
                onChange({
                  ...doc,
                  sections: {
                    ...s,
                    objects: { ...s.objects, featuredProductId: v.trim() || null },
                  },
                })
              }
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
            <Field
              label="Featured software ID"
              value={s.systems.featuredSoftwareId ?? ""}
              onChange={(v) =>
                onChange({
                  ...doc,
                  sections: {
                    ...s,
                    systems: { ...s.systems, featuredSoftwareId: v.trim() || null },
                  },
                })
              }
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
            <Field
              label="Featured text ID"
              value={s.texts.featuredTextId ?? ""}
              onChange={(v) =>
                onChange({
                  ...doc,
                  sections: { ...s, texts: { ...s.texts, featuredTextId: v.trim() || null } },
                })
              }
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
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);

  const semverOk = version.trim() === "" || isValidVersion(version.trim());

  async function publish(): Promise<void> {
    setError(null);
    setMessage(null);
    setPublished(null);
    const v = version.trim();
    if (!isValidVersion(v)) {
      setError("invalid_version");
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
        setError(res.error);
        setMessage(res.message ?? null);
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
        Freezes the current draft into an immutable versioned release. References are validated at
        publish.
      </p>
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>Couldn't publish</AlertTitle>
          <AlertDescription>
            {MESSAGES[error] ?? error}
            {message && <span className="mt-1 block font-mono text-xs opacity-80">{message}</span>}
          </AlertDescription>
        </Alert>
      )}
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
    </Section>
  );
}

function DangerSection({ pageKey, onDeleted }: { pageKey: PageKey; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Danger zone">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground font-mono text-xs">
          Permanently delete this page document and every release.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete page
        </Button>
      </div>
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card variant="soft" className="mb-6 p-5">
      <h2 className="text-foreground mb-3 font-semibold">{title}</h2>
      {children}
    </Card>
  );
}

function BackLink() {
  return (
    <Link
      to="/pages"
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all pages
    </Link>
  );
}
