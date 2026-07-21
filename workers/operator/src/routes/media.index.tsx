import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { PublisherMediaDTO } from "@si/contracts";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Badge } from "@si/ui/components/badge";
import { toast } from "@si/ui/components/sonner";
import { DeletionDialog } from "@/components/deletion-dialog";
import { PageHeader } from "@/components/page-header";
import { getText, listTexts } from "@/lib/texts.functions";
import { getSoftware, listSoftware } from "@/lib/software.functions";
import { getPage } from "@/lib/pages.functions";
import { deleteMedia, planMediaDeletion } from "@/lib/media.functions";
import { PAGE_KEYS, PAGE_KEY_LABELS, pageDocumentMediaRefs } from "@/lib/page-forms";

// Media is addressed cross-owner by mediaId, but there is NO cross-owner listing
// RPC (RFC-0001 D10). So this is an owner-scoped browser: pick owner type → pick
// a record → view/delete its media. Text/software expose PublisherMediaDTO
// arrays; page media are referenced by id inside the page document.
const OWNER_TYPES = ["text", "software", "page"] as const;
type OwnerType = (typeof OWNER_TYPES)[number];

function toOwnerType(value: unknown): OwnerType {
  return (OWNER_TYPES as readonly string[]).includes(String(value)) ? (value as OwnerType) : "text";
}

type RecordRow = { id: string; label: string; sub: string };
type PageRef = { slot: string; mediaId: string };
type Selected = { label: string; media: PublisherMediaDTO[]; pageRefs: PageRef[] } | null;
type LoaderData = {
  ownerType: OwnerType;
  ownerId: string | null;
  records: RecordRow[];
  selected: Selected;
};

export const Route = createFileRoute("/media/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { ownerType: OwnerType; ownerId?: string } => ({
    ownerType: toOwnerType(search.ownerType),
    ownerId: typeof search.ownerId === "string" ? search.ownerId : undefined,
  }),
  loaderDeps: ({ search }) => ({ ownerType: search.ownerType, ownerId: search.ownerId }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const { ownerType, ownerId } = deps;
    let records: RecordRow[] = [];
    if (ownerType === "text") {
      const r = await listTexts({ data: { state: "all" } });
      records = r.ok
        ? r.value.texts.map((t) => ({ id: t.textId, label: t.title, sub: t.slug }))
        : [];
    } else if (ownerType === "software") {
      const r = await listSoftware({ data: { state: "all" } });
      records = r.ok
        ? r.value.software.map((s) => ({ id: s.softwareId, label: s.title, sub: s.slug }))
        : [];
    } else {
      records = PAGE_KEYS.map((k) => ({ id: k, label: PAGE_KEY_LABELS[k], sub: k }));
    }

    let selected: Selected = null;
    if (ownerId) {
      if (ownerType === "text") {
        const r = await getText({ data: { textId: ownerId } });
        if (r.ok) selected = { label: r.value.draft.title, media: r.value.media, pageRefs: [] };
      } else if (ownerType === "software") {
        const r = await getSoftware({ data: { softwareId: ownerId } });
        if (r.ok) selected = { label: r.value.draft.title, media: r.value.media, pageRefs: [] };
      } else if ((PAGE_KEYS as readonly string[]).includes(ownerId)) {
        const r = await getPage({ data: { key: ownerId as (typeof PAGE_KEYS)[number] } });
        if (r.ok)
          selected = {
            label: `${PAGE_KEY_LABELS[r.value.key]} page`,
            media: [],
            pageRefs: pageDocumentMediaRefs(r.value.document),
          };
      }
    }

    return { ownerType, ownerId: ownerId ?? null, records, selected };
  },
  component: MediaBrowser,
});

function MediaBrowser() {
  const { ownerType, ownerId, records, selected } = Route.useLoaderData();
  const navigate = useNavigate();

  // Owner-scoped load failure (record exists in the picker but its media can't
  // be fetched) surfaces as a toast — the app-frame error channel — instead of
  // an inline block that competes with the panel.
  useEffect(() => {
    if (ownerId && !selected) toast.error("Couldn't load that record's media.");
  }, [ownerId, selected]);

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        title="Media"
        subtitle="Browse and delete media by owner. Upload happens from each record's editor (T19)."
      />

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {OWNER_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => void navigate({ to: "/media", search: { ownerType: t } })}
              className={
                "rounded-sm border px-3 py-1 font-mono text-xs capitalize transition-colors " +
                (ownerType === t
                  ? "border-primary text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground")
              }
            >
              {t}
            </button>
          ))}
        </div>
        <p className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
          Owner-scoped · no cross-owner listing
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[16rem_1fr] lg:min-h-0 lg:flex-1">
        <Card className="overflow-auto p-0 lg:min-h-0">
          {records.length === 0 ? (
            <p className="text-muted-foreground p-4 font-mono text-xs">No records.</p>
          ) : (
            records.map((r, i) => {
              const active = r.id === ownerId;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() =>
                    void navigate({ to: "/media", search: { ownerType, ownerId: r.id } })
                  }
                  className={
                    "flex w-full flex-col items-start gap-0.5 p-3 text-left transition-colors " +
                    (i < records.length - 1 ? "border-border border-b " : "") +
                    (active ? "bg-muted" : "hover:bg-muted/50")
                  }
                >
                  <span className="text-foreground text-sm font-medium">{r.label}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">{r.sub}</span>
                </button>
              );
            })
          )}
        </Card>

        <div className="flex min-h-0 flex-col">
          {!ownerId ? (
            <Card
              variant="soft"
              className="text-muted-foreground flex flex-1 items-center justify-center p-12 text-center font-mono text-sm"
            >
              Select a record to view its media.
            </Card>
          ) : !selected ? (
            <Card
              variant="soft"
              className="text-muted-foreground flex flex-1 items-center justify-center p-12 text-center font-mono text-sm"
            >
              Record unavailable.
            </Card>
          ) : (
            <MediaPanel
              selected={selected}
              onChanged={() => void navigate({ to: "/media", search: { ownerType, ownerId } })}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Detail panel: a pinned header (record label + item count) over a body that
// scrolls inside the card on wide screens (app-frame rule — scroll lives in the
// inner region, never the page).
function MediaPanel({
  selected,
  onChanged,
}: {
  selected: NonNullable<Selected>;
  onChanged: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(id: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      // clipboard blocked — no-op
    }
  }

  const count = selected.media.length + selected.pageRefs.length;
  const hasMedia = count > 0;

  return (
    <Card variant="soft" className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden p-0">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-foreground truncate font-semibold">{selected.label}</h2>
        <span className="text-muted-foreground shrink-0 font-mono text-[10px] uppercase tracking-wider">
          {count} {count === 1 ? "item" : "items"}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {!hasMedia ? (
          <p className="text-muted-foreground font-mono text-xs">No media for this record.</p>
        ) : (
          <div className="grid gap-3">
            {selected.media.map((m) => (
              <div
                key={m.id}
                className="border-border flex flex-wrap items-center gap-3 rounded-sm border p-3 text-sm"
              >
                {m.state === "ready" && m.href ? (
                  <img
                    src={m.href}
                    alt={m.alt}
                    className="border-border size-14 shrink-0 rounded-sm border object-cover"
                  />
                ) : (
                  <div className="bg-surface-sunken size-14 shrink-0 rounded-sm" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate">{m.alt || "—"}</p>
                  <button
                    type="button"
                    onClick={() => void copy(m.id)}
                    className="text-muted-foreground hover:text-foreground font-mono text-[10px]"
                  >
                    {copied === m.id ? "copied ✓" : `${m.id} · copy`}
                  </button>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {m.role}
                </Badge>
                <Badge
                  variant={m.state === "ready" ? "success" : "warning"}
                  className="font-mono text-[10px] uppercase"
                >
                  {m.state}
                </Badge>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDeletingId(m.id)}
                >
                  Delete
                </Button>
              </div>
            ))}

            {selected.pageRefs.map((ref) => (
              <div
                key={ref.slot}
                className="border-border flex flex-wrap items-center gap-3 rounded-sm border p-3 text-sm"
              >
                <Badge variant="outline" className="font-mono text-[10px] uppercase">
                  {ref.slot}
                </Badge>
                <button
                  type="button"
                  onClick={() => void copy(ref.mediaId)}
                  className="text-muted-foreground hover:text-foreground min-w-0 flex-1 truncate text-left font-mono text-[10px]"
                >
                  {copied === ref.mediaId ? "copied ✓" : `${ref.mediaId} · copy`}
                </button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDeletingId(ref.mediaId)}
                >
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {deletingId && (
        <DeletionDialog
          open
          onOpenChange={(o) => {
            if (!o) setDeletingId(null);
          }}
          title="Delete media"
          confirmPhrase={deletingId}
          plan={() => planMediaDeletion({ data: { mediaId: deletingId } })}
          confirm={(input) =>
            deleteMedia({
              data: { commandId: crypto.randomUUID(), confirmationToken: input.confirmationToken },
            })
          }
          onDeleted={() => {
            setDeletingId(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}
