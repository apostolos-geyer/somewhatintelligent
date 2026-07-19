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
import { PublisherStatusBadge } from "@/components/publisher-status-badge";
import { DeletionDialog } from "@/components/deletion-dialog";
import {
  deleteSoftware,
  getSoftware,
  planSoftwareDeletion,
  publishSoftware,
  retireSoftware,
  saveSoftwareDraft,
} from "@/lib/software.functions";
import { formatDate } from "@/lib/format";

const MESSAGES: Record<string, string> = {
  not_found: "This entry no longer exists — reload the list.",
  revision_conflict: "The draft changed since you loaded it. Reload and reapply your edit.",
  slug_taken: "That slug is already in use.",
  invalid_destination: "Enter a valid https:// destination URL.",
  invalid_media: "That media does not belong to this entry.",
  missing_media: "Add a primary image before publishing.",
};

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
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card variant="soft" className="mt-4 p-10 text-center">
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
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <div className="mb-6 mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">{draft.title}</h1>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {draft.slug} · rev {revision} · updated {formatDate(draft.updatedAt)}
          </p>
        </div>
        <PublisherStatusBadge state={draft.state} />
      </div>

      {conflict && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Draft changed elsewhere</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>
              This entry was edited elsewhere. Reload to get the latest revision — your unsaved
              change was not applied.
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

      <DetailsSection draft={draft} disabled={conflict} onSave={saveDraft} />
      <WhatItIsSection draft={draft} disabled={conflict} onSave={saveDraft} />
      <MediaSection
        media={data.media}
        primaryMediaId={draft.primaryMediaId}
        disabled={conflict}
        onSetPrimary={(id) => saveDraft({ primaryMediaId: id })}
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
    </div>
  );
}

function DetailsSection({
  draft,
  disabled,
  onSave,
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
}) {
  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [deck, setDeck] = useState(draft.deck);
  const [destinationUrl, setDestinationUrl] = useState(draft.destinationUrl);
  const [actionLabel, setActionLabel] = useState(draft.actionLabel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setError(null);
    setSaved(false);
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
        setError(res.error ?? "save_failed");
        return;
      }
      setSaved(true);
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
        {error && <ErrorAlert code={error} />}
        {saved && !error && <p className="text-success font-mono text-xs">Saved.</p>}
        <div className="grid gap-2">
          <Label htmlFor="title">Name</Label>
          <Input
            id="title"
            value={title}
            disabled={disabled}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-2 sm:max-w-sm">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            value={slug}
            disabled={disabled}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="deck">Deck</Label>
          <Input
            id="deck"
            value={deck}
            disabled={disabled}
            onChange={(e) => setDeck(e.target.value)}
            placeholder="A one-line description"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="destination">Destination URL</Label>
            <Input
              id="destination"
              type="url"
              value={destinationUrl}
              disabled={disabled}
              onChange={(e) => setDestinationUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="action">Action label</Label>
            <Input
              id="action"
              value={actionLabel}
              disabled={disabled}
              onChange={(e) => setActionLabel(e.target.value)}
              placeholder="Open"
            />
          </div>
        </div>
        <p className="text-muted-foreground/70 font-mono text-[10px]">
          Publisher stores the destination as inert authored data and never fetches or follows it.
        </p>
        <div>
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
}: {
  draft: SoftwareDraftDTO;
  disabled: boolean;
  onSave: (patch: { whatItIsMarkdown: string }) => Promise<{ ok: boolean; error?: string }>;
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
    <Section title="What it is">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-muted-foreground font-mono text-xs">Markdown.</p>
        <AutosaveIndicator status={autosave.status} />
      </div>
      <MarkdownField
        value={body}
        onValueChange={setBody}
        disabled={disabled}
        footer={(stats) => (
          <span className="font-mono text-[10px]">
            {stats.words} words · {stats.chars} chars
          </span>
        )}
        placeholder="Describe the system…"
        rows={12}
      />
    </Section>
  );
}

function MediaSection({
  media,
  primaryMediaId,
  disabled,
  onSetPrimary,
}: {
  media: PublisherMediaDTO[];
  primaryMediaId: string | null;
  disabled: boolean;
  onSetPrimary: (id: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  async function setPrimary(id: string): Promise<void> {
    setBusy(id);
    try {
      await onSetPrimary(id);
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
      <p className="text-muted-foreground/70 mt-2 font-mono text-[10px]">
        Upload from the editor lands with T19. Manage media in the Media module.
      </p>
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
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [retireBusy, setRetireBusy] = useState(false);

  async function publish(): Promise<void> {
    setError(null);
    setPublished(false);
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
        setError(res.error);
        return;
      }
      setPublished(true);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function retire(): Promise<void> {
    setError(null);
    setRetireBusy(true);
    try {
      const res = await retireSoftware({
        data: { commandId: crypto.randomUUID(), softwareId: draft.softwareId },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    } finally {
      setRetireBusy(false);
    }
  }

  return (
    <Section title="Publish">
      <p className="text-muted-foreground mb-3 font-mono text-xs">
        Publishes the current draft as the live snapshot. Requires a valid destination and a primary
        image.
      </p>
      {error && <ErrorAlert code={error} />}
      {published && !error && <p className="text-success mb-3 font-mono text-xs">Published.</p>}
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
    <Section title="Danger zone">
      <div className="flex items-center justify-between gap-3">
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
      to="/software"
      search={{ state: "all" }}
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all software
    </Link>
  );
}
