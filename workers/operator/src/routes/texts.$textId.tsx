import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useRef, useState, type ReactNode } from "react";
import { isValidVersion } from "@si/contracts";
import type { PublisherMediaDTO, TextDraftDTO } from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Textarea } from "@si/ui/components/textarea";
import { Badge } from "@si/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { MarkdownEditor } from "@si/ui/components/editor";
import { TagInput } from "@si/ui/components/tag-input";
import { AutosaveIndicator } from "@si/ui/components/autosave-indicator";
import { useAutosave } from "@si/ui/hooks/use-autosave";
import { PublisherStatusBadge } from "@/components/publisher-status-badge";
import { PublisherMediaUpload } from "@/components/publisher-media-upload";
import { DeletionDialog } from "@/components/deletion-dialog";
import { PreviewPanel } from "@/components/preview-panel";
import type { PreviewPayload } from "@/lib/preview";
import {
  deleteText,
  deleteTextRelease,
  getText,
  planTextDeletion,
  planTextReleaseDeletion,
  publishText,
  retireText,
  saveTextDraft,
  searchTexts,
} from "@/lib/texts.functions";
import { formatDate } from "@/lib/format";

const MESSAGES: Record<string, string> = {
  not_found: "This text no longer exists — reload the list.",
  revision_conflict: "The draft changed since you loaded it. Reload and reapply your edit.",
  slug_taken: "That slug is already in use.",
  invalid_version: "Enter a version like 1.0.0.",
  version_exists: "That version was already published.",
};

type Detail = {
  draft: TextDraftDTO;
  releases: Array<{ id: string; version: string; publishedAt: number }>;
  media: PublisherMediaDTO[];
};

export const Route = createFileRoute("/texts/$textId")({
  loader: ({ params }) => getText({ data: { textId: params.textId } }),
  component: TextDetail,
});

function TextDetail() {
  const result = Route.useLoaderData();
  if (!result.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card variant="soft" className="mt-4 p-10 text-center">
          <p className="text-foreground font-mono text-sm">Text not found.</p>
          <p className="text-muted-foreground mt-1 text-xs">It may have been deleted.</p>
        </Card>
      </div>
    );
  }
  // Remount the whole editor when the loader revision changes (post-reload), so
  // every field re-seeds from the fresh draft.
  return (
    <TextView
      key={`${result.value.draft.textId}:${result.value.draft.revision}`}
      data={result.value}
    />
  );
}

function TextView({ data }: { data: Detail }) {
  const router = useRouter();
  const navigate = useNavigate();
  const { draft } = data;

  // Shared optimistic-concurrency revision: every successful save bumps it so the
  // next save (body autosave or details) sends the current expectedRevision.
  const revisionRef = useRef(draft.revision);
  const [revision, setRevision] = useState(draft.revision);
  const [conflict, setConflict] = useState(false);

  // Live mirror of the editable fields (details + body) so the preview reflects
  // what the operator currently sees in the form, including unsaved edits.
  const previewRef = useRef({
    title: draft.title,
    slug: draft.slug,
    deck: draft.deck ?? "",
    bodyMarkdown: draft.bodyMarkdown,
    tags: draft.tags,
  });
  const onField = (patch: Partial<typeof previewRef.current>): void => {
    Object.assign(previewRef.current, patch);
  };
  const getPreviewPayload = (): PreviewPayload => {
    const p = previewRef.current;
    return {
      kind: "text",
      title: p.title,
      slug: p.slug,
      deck: p.deck.trim() ? p.deck : null,
      tags: p.tags,
      bodyMarkdown: p.bodyMarkdown,
      version: draft.activeVersion ?? "draft",
      publishedAt: Date.now(),
    };
  };

  async function saveDraft(patch: {
    title?: string;
    slug?: string;
    deck?: string | null;
    bodyMarkdown?: string;
    tags?: string[];
  }): Promise<{ ok: boolean }> {
    const res = await saveTextDraft({
      data: {
        commandId: crypto.randomUUID(),
        textId: draft.textId,
        expectedRevision: revisionRef.current,
        ...patch,
      },
    });
    if (!res.ok) {
      if (res.error === "revision_conflict") setConflict(true);
      return { ok: false };
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
              This text was edited in another tab or by another operator. Reload to get the latest
              revision before editing — your unsaved change was not applied.
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

      <DetailsSection draft={draft} disabled={conflict} onSave={saveDraft} onField={onField} />
      <BodySection draft={draft} disabled={conflict} onSave={saveDraft} onField={onField} />
      <PreviewPanel getPayload={getPreviewPayload} disabled={conflict} />
      <MediaSection
        textId={draft.textId}
        media={data.media}
        onUploaded={() => void router.invalidate()}
      />
      <PublishSection
        draft={draft}
        revision={revision}
        disabled={conflict}
        onDone={() => void router.invalidate()}
      />
      <ReleasesSection
        textId={draft.textId}
        releases={data.releases}
        activeVersion={draft.activeVersion}
        onDone={() => void router.invalidate()}
      />
      <DangerSection
        draft={draft}
        onDeleted={() => void navigate({ to: "/texts", search: { state: "all" } })}
      />
    </div>
  );
}

// ── Metadata: title / slug / deck / tags (one save, minimal race surface) ──────
function DetailsSection({
  draft,
  disabled,
  onSave,
  onField,
}: {
  draft: TextDraftDTO;
  disabled: boolean;
  onSave: (patch: {
    title?: string;
    slug?: string;
    deck?: string | null;
    tags?: string[];
  }) => Promise<{ ok: boolean }>;
  onField: (patch: { title?: string; slug?: string; deck?: string; tags?: string[] }) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [slug, setSlug] = useState(draft.slug);
  const [deck, setDeck] = useState(draft.deck ?? "");
  const [tags, setTags] = useState<string[]>(draft.tags);
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
        deck: deck.trim() ? deck : null,
        tags,
      });
      if (!res.ok) {
        setError("save_failed");
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
          <Label htmlFor="title">Title</Label>
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
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
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
          <Label htmlFor="deck">Deck (optional standfirst)</Label>
          <Textarea
            id="deck"
            rows={2}
            value={deck}
            disabled={disabled}
            onChange={(e) => {
              setDeck(e.target.value);
              onField({ deck: e.target.value });
            }}
            placeholder="A one-line summary shown under the title…"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="tags">Tags</Label>
          <TagInput
            id="tags"
            value={tags}
            onValueChange={(v) => {
              setTags(v);
              onField({ tags: v });
            }}
            disabled={disabled}
            placeholder="Add a tag…"
          />
        </div>
        <div>
          <Button type="submit" disabled={busy || disabled}>
            {busy ? "Saving…" : "Save details"}
          </Button>
        </div>
      </form>
    </Section>
  );
}

// ── Body: MarkdownEditor (split/preview + fullscreen) + debounced autosave ─────
function BodySection({
  draft,
  disabled,
  onSave,
  onField,
}: {
  draft: TextDraftDTO;
  disabled: boolean;
  onSave: (patch: { bodyMarkdown: string }) => Promise<{ ok: boolean }>;
  onField: (patch: { bodyMarkdown?: string }) => void;
}) {
  const [body, setBody] = useState(draft.bodyMarkdown);
  const autosave = useAutosave({
    value: body,
    savedValue: draft.bodyMarkdown,
    onSave: (v) => onSave({ bodyMarkdown: v }),
  });

  return (
    <Section title="Body">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-muted-foreground font-mono text-xs">
          Markdown with a live preview. Type <span className="text-foreground">[[</span> to link
          another text.
        </p>
        <AutosaveIndicator status={autosave.status} />
      </div>
      <MarkdownEditor
        value={body}
        onChange={(v) => {
          setBody(v);
          onField({ bodyMarkdown: v });
        }}
        readOnly={disabled}
        defaultMode="split"
        wikilink={(query) => searchTexts({ data: { query } })}
        placeholder="Write…"
        className="h-[70vh] min-h-[420px]"
      />
    </Section>
  );
}

function MediaSection({
  textId,
  media,
  onUploaded,
}: {
  textId: string;
  media: PublisherMediaDTO[];
  onUploaded: () => void;
}) {
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
              <Badge variant={m.state === "ready" ? "success" : "warning"}>{m.state}</Badge>
            </div>
          ))}
          <p className="text-muted-foreground/70 font-mono text-[10px]">
            Image previews resolve once a release references the media (draft media is not public).
          </p>
        </div>
      )}
      <PublisherMediaUpload ownerType="text" ownerId={textId} onUploaded={onUploaded} />
    </Section>
  );
}

// ── Publish (version-gated immutable release) ──────────────────────────────────
function PublishSection({
  draft,
  revision,
  disabled,
  onDone,
}: {
  draft: TextDraftDTO;
  revision: number;
  disabled: boolean;
  onDone: () => void;
}) {
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);

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
      const res = await publishText({
        data: {
          commandId: crypto.randomUUID(),
          textId: draft.textId,
          expectedRevision: revision,
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

  async function retire(): Promise<void> {
    setError(null);
    setRetireBusy(true);
    try {
      const res = await retireText({
        data: { commandId: crypto.randomUUID(), textId: draft.textId },
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
        Freezes the current draft into an immutable versioned release.
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
            disabled={disabled}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="1.0.0"
            aria-invalid={!semverOk}
          />
        </div>
        <Button type="submit" disabled={busy || disabled || !isValidVersion(version.trim())}>
          {busy ? "Publishing…" : "Publish release"}
        </Button>
        {draft.state === "published" && (
          <Button
            type="button"
            variant="outline"
            disabled={retireBusy}
            onClick={() => void retire()}
          >
            {retireBusy ? "Retiring…" : "Retire"}
          </Button>
        )}
      </form>
      {!semverOk && (
        <p className="text-destructive mt-2 font-mono text-xs">Use a MAJOR.MINOR.PATCH version.</p>
      )}
    </Section>
  );
}

// ── Releases + per-release deletion (shared DeletionDialog) ─────────────────────
function ReleasesSection({
  textId,
  releases,
  activeVersion,
  onDone,
}: {
  textId: string;
  releases: Detail["releases"];
  activeVersion: string | null;
  onDone: () => void;
}) {
  const [deleting, setDeleting] = useState<{ id: string; version: string } | null>(null);
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
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground text-xs">{formatDate(r.publishedAt)}</span>
              <Button
                size="xs"
                variant="ghost"
                className="text-destructive"
                onClick={() => setDeleting({ id: r.id, version: r.version })}
              >
                Delete
              </Button>
            </div>
          </div>
        ))}
      </div>
      {deleting && (
        <DeletionDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null);
          }}
          title={`Delete release ${deleting.version}`}
          confirmPhrase={deleting.version}
          plan={() => planTextReleaseDeletion({ data: { textId, releaseId: deleting.id } })}
          confirm={(input) =>
            deleteTextRelease({
              data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
            })
          }
          onDeleted={() => {
            setDeleting(null);
            onDone();
          }}
        />
      )}
    </Section>
  );
}

function DangerSection({ draft, onDeleted }: { draft: TextDraftDTO; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Danger zone">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground font-mono text-xs">
          Permanently delete this text and every release.
        </p>
        <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
          Delete text
        </Button>
      </div>
      <DeletionDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete “${draft.title}”`}
        confirmPhrase={draft.slug}
        plan={() => planTextDeletion({ data: { textId: draft.textId } })}
        confirm={(input) =>
          deleteText({
            data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
          })
        }
        onDeleted={onDeleted}
      />
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
      to="/texts"
      search={{ state: "all" }}
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all texts
    </Link>
  );
}
