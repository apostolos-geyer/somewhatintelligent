import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Badge } from "@si/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { toast } from "@si/ui/components/sonner";
import { PageHeader } from "@/components/page-header";
import { PublisherStatusBadge } from "@/components/publisher-status-badge";
import { createText, listTexts } from "@/lib/texts.functions";

// Texts = the writing surface: long-form drafts, versioned releases (RFC-0001 D13).
const STATES = ["all", "draft", "published", "retired"] as const;
type StateFilter = (typeof STATES)[number];

function toState(value: unknown): StateFilter {
  return (STATES as readonly string[]).includes(String(value)) ? (value as StateFilter) : "all";
}

export const Route = createFileRoute("/texts/")({
  validateSearch: (search: Record<string, unknown>): { state: StateFilter } => ({
    state: toState(search.state),
  }),
  loaderDeps: ({ search }) => ({ state: search.state }),
  loader: ({ deps }) => listTexts({ data: { state: deps.state } }),
  component: TextsList,
});

/** Client-side slug suggestion; Publisher is authoritative and re-slugifies. */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

const CREATE_ERROR: Record<string, string> = {
  slug_taken: "That slug is already in use — pick another.",
};

const TABLE_HEADS = ["Title", "Slug", "Status", "Live version", "Tags", ""] as const;

function TextsList() {
  const result = Route.useLoaderData();
  const { state } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  function onTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  function onDialogOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) {
      setTitle("");
      setSlug("");
      setSlugEdited(false);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const res = await createText({
        data: { commandId: crypto.randomUUID(), slug: slug.trim(), title: title.trim() },
      });
      if (!res.ok) {
        toast.error("Couldn't create the text", {
          description: CREATE_ERROR[res.error] ?? res.error,
        });
        return;
      }
      toast.success("Draft created", { description: title.trim() });
      setOpen(false);
      await navigate({ to: "/texts/$textId", params: { textId: res.value.textId } });
    } catch {
      toast.error("Couldn't create the text", {
        description: "Something went wrong — try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        title="Texts"
        subtitle="Long-form writing and releases."
        actions={<Button onClick={() => onDialogOpenChange(true)}>New text</Button>}
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void navigate({ to: "/texts", search: { state: s } })}
            className={
              "rounded-sm border px-3 py-1 font-mono text-xs capitalize transition-colors " +
              (state === s
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {s}
          </button>
        ))}
      </div>

      {!result.ok ? (
        <Card variant="soft" className="p-8 text-center">
          <p className="text-destructive font-mono text-sm">Couldn't load texts.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void router.invalidate()}
          >
            Retry
          </Button>
        </Card>
      ) : result.value.texts.length === 0 ? (
        <Card variant="soft" className="text-muted-foreground p-12 text-center font-mono text-sm">
          No texts in this view.
        </Card>
      ) : (
        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  {TABLE_HEADS.map((h, i) => (
                    <th
                      key={h || `col-${i}`}
                      className="bg-surface-sunken text-muted-foreground border-border border-b p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.value.texts.map((t, i) => (
                  <tr
                    key={t.textId}
                    className={i < result.value.texts.length - 1 ? "border-border border-b" : ""}
                  >
                    <td className="text-foreground p-3 text-sm font-semibold">{t.title}</td>
                    <td className="text-muted-foreground p-3 font-mono text-xs">{t.slug}</td>
                    <td className="p-3">
                      <PublisherStatusBadge state={t.state} />
                    </td>
                    <td className="text-muted-foreground p-3 font-mono text-xs">
                      {t.activeVersion ?? "—"}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {t.tags.length === 0 ? (
                          <span className="text-muted-foreground font-mono text-xs">—</span>
                        ) : (
                          t.tags.slice(0, 4).map((tag) => (
                            <Badge key={tag} variant="secondary" className="text-[10px]">
                              {tag}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        to="/texts/$textId"
                        params={{ textId: t.textId }}
                        className="text-primary font-mono text-xs underline-offset-4 hover:underline"
                      >
                        edit →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={open} onOpenChange={onDialogOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New text</DialogTitle>
            <DialogDescription>
              Create a draft. The slug is suggested from the title and can be edited.
            </DialogDescription>
          </DialogHeader>

          <form
            id="new-text-form"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="new-title">Title</Label>
              <Input
                id="new-title"
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="On the design of small tools"
                autoComplete="off"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-slug">Slug</Label>
              <Input
                id="new-slug"
                value={slug}
                onChange={(e) => {
                  setSlugEdited(true);
                  setSlug(e.target.value);
                }}
                placeholder="on-the-design-of-small-tools"
                autoComplete="off"
                spellCheck={false}
                required
              />
            </div>
          </form>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onDialogOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-text-form"
              disabled={busy || !title.trim() || !slug.trim()}
            >
              {busy ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
