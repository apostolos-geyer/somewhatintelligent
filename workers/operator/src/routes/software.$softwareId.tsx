import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import type { PublisherMediaDTO, SoftwareDraftDTO } from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Badge } from "@si/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { MarkdownField } from "@si/ui/components/markdown-field";
import { AutosaveIndicator } from "@si/ui/components/autosave-indicator";
import { useAutosave } from "@si/ui/hooks/use-autosave";
import { toast } from "@si/ui/components/sonner";
import { Section } from "@/components/section";
import { SplitLayout } from "@/components/split-layout";
import { PublisherStatusBadge } from "@/components/publisher-status-badge";
import { PublisherMediaUpload } from "@/components/publisher-media-upload";
import { DeletionDialog } from "@/components/deletion-dialog";
import { PreviewPanel } from "@/components/preview-panel";
import type { PreviewPayload } from "@/lib/preview";
import {
  deleteSoftware,
  getSoftware,
  planSoftwareDeletion,
  publishSoftware,
  retireSoftware,
  saveSoftwareDraft,
} from "@/lib/software.functions";
import { formatDate } from "@/lib/format";

// Friendly copy for every typed domain error the software mutations return.
const MESSAGES: Record<string, string> = {
  not_found: "This entry no longer exists — reload the list.",
  revision_conflict: "The draft changed since you loaded it. Reload and reapply your edit.",
  slug_taken: "That slug is already in use.",
  invalid_destination: "Enter a valid https:// destination URL.",
  invalid_media: "That media does not belong to this entry.",
  missing_media: "Add a primary image before publishing.",
  save_failed: "Couldn't save your changes — try again.",
};

// Every transient action result surfaces as a toast (the app frame mounts a
// single <Toaster>). Persistent modes — the revision-conflict banner and the
// typed-confirmation delete dialog — keep their own inline UI.
function toastError(code: string): void {
  toast.error(MESSAGES[code] ?? "Couldn't complete that action.");
}

type Detail = {
  draft: SoftwareDraftDTO;
  published: unknown;
  media: PublisherMediaDTO[];
};

export const Route = createFileRoute("/software/$softwareId")({
  loader: ({ params }) => getSoftware({ data: { softwareId: params.softwareId } }),
  component: SoftwareDetail,
});

function SoftwareDetail() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
        <BackLink />
        <Card variant="soft" className="p-10 text-center">
          <p className="text-foreground font-mono text-sm">Entry not found.</p>
          <p className="text-muted-foreground mt-1 text-xs">It may have been deleted.</p>
        </Card>
      </div>
    );
  }
  return (
    <SoftwareView
      key={`${result.value.draft.softwareId}:${result.value.draft.revision}`}
      data={result.value}
    />
  );
}

function SoftwareView({ data }: { data: Detail }) {
  const router = useRouter();
  const navigate = useNavigate();
  const { draft } = data;

  const revisionRef = useRef(draft.revision);
  const [revision, setRevision] = useState(draft.revision);
  const [conflict, setConflict] = useState(false);

  // Live mirror of the editable fields so the preview reflects the current form,
  // including unsaved edits (RFC-0001 D14).
  const previewRef = useRef({
    title: draft.title,
    slug: draft.slug,
    deck: draft.deck,
    whatItIsMarkdown: draft.whatItIsMarkdown,
    destinationUrl: draft.destinationUrl,
    actionLabel: draft.actionLabel,
  });
  const onField = (patch: Partial<typeof previewRef.current>): void => {
    Object.assign(previewRef.current, patch);
  };
  const getPreviewPayload = (): PreviewPayload => {
    const p = previewRef.current;
    return {
      kind: "software",
      name: p.title,
      slug: p.slug,
      deck: p.deck,
      whatItIsMarkdown: p.whatItIsMarkdown,
      destinationUrl: p.destinationUrl,
      actionLabel: p.actionLabel,
      updatedAt: Date.now(),
    };
  };

  async function saveDraft(patch: {
    title?: string;
    slug?: string;
    deck?: string;
    whatItIsMarkdown?: string;
    destinationUrl?: string;
    actionLabel?: string;
    primaryMediaId?: string | null;
  }): Promise<{ ok: boolean; error?: string }> {
    const res = await saveSoftwareDraft({
      data: {
        commandId: crypto.randomUUID(),
        softwareId: draft.softwareId,
        expectedRevision: revisionRef.current,
        ...patch,
      },
    });
    if (!res.ok) {
      if (res.error === "revision_conflict") setConflict(true);
      return { ok: false, error: res.error };
    }
    revisionRef.current = res.value.revision;
    setRevision(res.value.revision);
    return { ok: true };
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <SoftwareHeader draft={draft} revision={revision} />

      <SplitLayout
        railWidth="26rem"
        main={
          <>
            {conflict && (
              <Alert variant="destructive">
                <AlertTitle>Draft changed elsewhere</AlertTitle>
                <AlertDescription className="flex flex-col gap-2">
                  <span>
                    This entry was edited elsewhere. Reload to get the latest revision — your
                    unsaved change was not applied.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    onClick={() => void router.invalidate()}
                  >
                    Reload
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <DetailsSection
              draft={draft}
              disabled={conflict}
              onSave={saveDraft}
              onField={onField}
            />
            <WhatItIsSection
              draft={draft}
              disabled={conflict}
              onSave={saveDraft}
              onField={onField}
            />
            <PreviewPanel getPayload={getPreviewPayload} disabled={conflict} />
          </>
        }
        rail={
          <>
            <MediaSection
              softwareId={draft.softwareId}
              media={data.media}
              primaryMediaId={draft.primaryMediaId}
              disabled={conflict}
              onSetPrimary={(id) => saveDraft({ primaryMediaId: id })}
              onUploaded={() => void router.invalidate()}
            />
            <PublishSection
              draft={draft}
              revision={revision}
              disabled={conflict}
              onDone={() => void router.invalidate()}
            />
            <DangerSection
              draft={draft}
              onDeleted={() => void navigate({ to: "/software", search: { state: "all" } })}
            />
          </>
        }
      />
    </div>
  );
}

// ── Header: back eyebrow, large display title, and a mono meta strip ───────────
function SoftwareHeader({ draft, revision }: { draft: SoftwareDraftDTO; revision: number }) {
  return (
    <header className="flex shrink-0 flex-col gap-5">
      <BackLink />
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <h1 className="text-foreground font-display max-w-full break-words text-5xl font-bold uppercase leading-[0.9] tracking-tight md:text-6xl">
          {draft.title}
        </h1>
        <dl className="divide-border flex items-stretch divide-x">
          <MetaCell label="Slug" value={draft.slug} />
          <MetaCell label="State" value={<PublisherStatusBadge state={draft.state} />} />
          <MetaCell label="Rev" value={String(revision)} />
          <MetaCell label="Updated" value={formatDate(draft.updatedAt)} />
        </dl>
      </div>
    </header>
  );
}

function MetaCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 first:pl-0 last:pr-0">
      <dt className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
        {label}
      </dt>
      <dd className="text-foreground font-mono text-sm">{value}</dd>
    </div>
  );
}

// Mono uppercase field label — the console's authoring-form grammar.
function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <Label
      htmlFor={htmlFor}
      className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider"
    >
      {children}
    </Label>
  );
}

function DetailsSection({
  draft,
  disabled,
  onSave,
  onField,
}: {
  draft: SoftwareDraftDTO;
  disabled: boolean;
  onSave: (patch: {
    title?: string;
    slug?: string;
    deck?: string;
    destinationUrl?: string;
    actionLabel?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  onField: (patch: {
    title?: string;
    slug?: string;
    deck?: string;
    destinationUrl?: string;
    actionLabel?: string;
  }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [deck, setDeck] = useState(draft.deck);
  const [destinationUrl, setDestinationUrl] = useState(draft.destinationUrl);
  const [actionLabel, setActionLabel] = useState(draft.actionLabel);
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const res = await onSave({
        title: title.trim(),
        slug: slug.trim(),
        deck: deck.trim(),
        destinationUrl: destinationUrl.trim(),
        actionLabel: actionLabel.trim(),
      });
      if (!res.ok) {
        toastError(res.error ?? "save_failed");
        return;
      }
      toast.success("Details saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Details">
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-2">
          <FieldLabel htmlFor="title">Name</FieldLabel>
          <Input
            id="title"
            value={title}
            disabled={disabled}
            onChange={(e) => {
              setTitle(e.target.value);
              onField({ title: e.target.value });
            }}
            required
          />
        </div>
        <div className="grid gap-2 sm:max-w-sm">
          <FieldLabel htmlFor="slug">Slug</FieldLabel>
          <Input
            id="slug"
            className="font-mono"
            value={slug}
            disabled={disabled}
            onChange={(e) => {
              setSlug(e.target.value);
              onField({ slug: e.target.value });
            }}
            required
          />
        </div>
        <div className="grid gap-2">
          <FieldLabel htmlFor="deck">Deck</FieldLabel>
          <Input
            id="deck"
            value={deck}
            disabled={disabled}
            onChange={(e) => {
              setDeck(e.target.value);
              onField({ deck: e.target.value });
            }}
            placeholder="A one-line description"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <FieldLabel htmlFor="destination">Destination URL</FieldLabel>
            <Input
              id="destination"
              type="url"
              className="font-mono"
              value={destinationUrl}
              disabled={disabled}
              onChange={(e) => {
                setDestinationUrl(e.target.value);
                onField({ destinationUrl: e.target.value });
              }}
              placeholder="https://…"
            />
          </div>
          <div className="grid gap-2">
            <FieldLabel htmlFor="action">Action label</FieldLabel>
            <Input
              id="action"
              value={actionLabel}
              disabled={disabled}
              onChange={(e) => {
                setActionLabel(e.target.value);
                onField({ actionLabel: e.target.value });
              }}
              placeholder="Open"
            />
          </div>
        </div>
        <p className="text-muted-foreground/70 font-mono text-[10px]">
          Publisher stores the destination as inert authored data and never fetches or follows it.
        </p>
        <div className="border-border flex justify-end border-t pt-4">
          <Button type="submit" disabled={busy || disabled}>
            {busy ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function WhatItIsSection({
  draft,
  disabled,
  onSave,
  onField,
}: {
  draft: SoftwareDraftDTO;
  disabled: boolean;
  onSave: (patch: { whatItIsMarkdown: string }) => Promise<{ ok: boolean; error?: string }>;
  onField: (patch: { whatItIsMarkdown?: string }) => void;
}) {
  const [body, setBody] = useState(draft.whatItIsMarkdown);
  const autosave = useAutosave({
    value: body,
    savedValue: draft.whatItIsMarkdown,
    onSave: async (v) => {
      const res = await onSave({ whatItIsMarkdown: v });
      return { ok: res.ok };
    },
  });

  return (
    <Section title="What it is" actions={<AutosaveIndicator status={autosave.status} />}>
      <p className="text-muted-foreground mb-2 font-mono text-xs">Markdown.</p>
      <MarkdownField
        value={body}
        onValueChange={(v) => {
          setBody(v);
          onField({ whatItIsMarkdown: v });
        }}
        disabled={disabled}
        footer={(stats) => (
          <span className="font-mono text-[10px]">
            {stats.words} words · {stats.chars} chars
          </span>
        )}
        placeholder="Describe the system…"
        rows={14}
      />
    </Section>
  );
}

function MediaSection({
  softwareId,
  media,
  primaryMediaId,
  disabled,
  onSetPrimary,
  onUploaded,
}: {
  softwareId: string;
  media: PublisherMediaDTO[];
  primaryMediaId: string | null;
  disabled: boolean;
  onSetPrimary: (id: string) => Promise<{ ok: boolean; error?: string }>;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function setPrimary(id: string): Promise<void> {
    setBusy(id);
    try {
      const res = await onSetPrimary(id);
      if (!res.ok) {
        toastError(res.error ?? "save_failed");
        return;
      }
      toast.success("Primary image updated.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section title="Media">
      {media.length === 0 ? (
        <p className="text-muted-foreground font-mono text-xs">
          No media yet. Publishing requires a primary image.
        </p>
      ) : (
        <div className="grid gap-2">
          {media.map((m) => {
            const isPrimary = m.id === primaryMediaId;
            return (
              <div
                key={m.id}
                className="border-border flex flex-wrap items-center gap-3 rounded-sm border p-3 text-sm"
              >
                {m.state === "ready" && m.href ? (
                  <img
                    src={m.href}
                    alt={m.alt}
                    className="border-border size-12 shrink-0 rounded-sm border object-cover"
                  />
                ) : (
                  <div className="bg-surface-sunken size-12 shrink-0 rounded-sm" />
                )}
                <span className="text-foreground min-w-0 flex-1 truncate">{m.alt || "—"}</span>
                <Badge variant={m.state === "ready" ? "success" : "warning"}>{m.state}</Badge>
                {isPrimary ? (
                  <Badge variant="outline" className="font-mono text-[10px] uppercase">
                    primary
                  </Badge>
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={disabled || busy === m.id}
                    onClick={() => void setPrimary(m.id)}
                  >
                    Set primary
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="text-muted-foreground/70 mb-3 mt-3 font-mono text-[10px]">
        Upload an image, then set it as the primary. A primary image is required to publish.
      </p>
      <PublisherMediaUpload
        ownerType="software"
        ownerId={softwareId}
        disabled={disabled}
        onUploaded={onUploaded}
      />
    </Section>
  );
}

function PublishSection({
  draft,
  revision,
  disabled,
  onDone,
}: {
  draft: SoftwareDraftDTO;
  revision: number;
  disabled: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);

  async function publish(): Promise<void> {
    setBusy(true);
    try {
      const res = await publishSoftware({
        data: {
          commandId: crypto.randomUUID(),
          softwareId: draft.softwareId,
          expectedRevision: revision,
        },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Published snapshot.");
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function retire(): Promise<void> {
    setRetireBusy(true);
    try {
      const res = await retireSoftware({
        data: { commandId: crypto.randomUUID(), softwareId: draft.softwareId },
      });
      if (!res.ok) {
        toastError(res.error);
        return;
      }
      toast.success("Retired.");
      onDone();
    } finally {
      setRetireBusy(false);
    }
  }

  return (
    <Section title="Publish">
      <p className="text-muted-foreground mb-4 font-mono text-xs">
        Publishes the current draft as the live snapshot. Requires a valid destination and a primary
        image.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || disabled} onClick={() => void publish()}>
          {busy ? "Publishing…" : "Publish snapshot"}
        </Button>
        {draft.state === "published" && (
          <Button variant="outline" disabled={retireBusy} onClick={() => void retire()}>
            {retireBusy ? "Retiring…" : "Retire"}
          </Button>
        )}
      </div>
    </Section>
  );
}

function DangerSection({ draft, onDeleted }: { draft: SoftwareDraftDTO; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Danger zone" tone="soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground font-mono text-xs">Permanently delete this entry.</p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete entry
        </Button>
      </div>
      <DeletionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${draft.title}”`}
        confirmPhrase={draft.slug}
        plan={() => planSoftwareDeletion({ data: { softwareId: draft.softwareId } })}
        confirm={(input) =>
          deleteSoftware({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={onDeleted}
      />
    </Section>
  );
}

function BackLink() {
  return (
    <Link
      to="/software"
      search={{ state: "all" }}
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all software
    </Link>
  );
}
