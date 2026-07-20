import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@si/ui/components/dialog";
import { toast } from "@si/ui/components/sonner";
import { PageHeader } from "@/components/page-header";
import { PublisherStatusBadge } from "@/components/publisher-status-badge";
import { createSoftware, listSoftware } from "@/lib/software.functions";

// Software = the systems/registry surface: authored "what it is" + a destination
// link Publisher never follows (RFC-0001 D8, inert authored data).
const STATES = ["all", "draft", "published", "retired"] as const;
type StateFilter = (typeof STATES)[number];

function toState(value: unknown): StateFilter {
  return (STATES as readonly string[]).includes(String(value)) ? (value as StateFilter) : "all";
}

export const Route = createFileRoute("/software/")({
  validateSearch: (search: Record<string, unknown>): { state: StateFilter } => ({
    state: toState(search.state),
  }),
  loaderDeps: ({ search }) => ({ state: search.state }),
  loader: ({ deps }) => listSoftware({ data: { state: deps.state } }),
  component: SoftwareList,
});

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

const COLUMNS = ["Name", "Slug", "Status", "Destination", ""] as const;

function SoftwareList() {
  const result = Route.useLoaderData();
  const { state } = Route.useSearch();
  const router = useRouter();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);

  function openDialog(next: boolean): void {
    setOpen(next);
    if (next) {
      setTitle("");
      setSlug("");
      setSlugEdited(false);
    }
  }

  function onTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const res = await createSoftware({
        data: { commandId: crypto.randomUUID(), slug: slug.trim(), title: title.trim() },
      });
      if (!res.ok) {
        toast.error(CREATE_ERROR[res.error] ?? res.error);
        return;
      }
      setOpen(false);
      toast.success(`Created ${title.trim()}.`);
      await navigate({ to: "/software/$softwareId", params: { softwareId: res.value.softwareId } });
    } catch {
      toast.error("Couldn't create the entry — try again.");
    } finally {
      setBusy(false);
    }
  }

  const count = result.ok ? result.value.software.length : 0;

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        eyebrow="Registry"
        title="Software"
        subtitle="Systems registry entries."
        actions={<Button onClick={() => openDialog(true)}>New software</Button>}
      />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => void navigate({ to: "/software", search: { state: s } })}
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

      <Card className="flex flex-col gap-0 overflow-hidden p-0 lg:min-h-0 lg:flex-1">
        <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <h2 className="text-muted-foreground font-mono text-[10px] font-semibold uppercase tracking-wider">
            {state === "all" ? "All entries" : state}
          </h2>
          <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            {count} {count === 1 ? "entry" : "entries"}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {!result.ok ? (
            <div className="flex flex-col items-center gap-4 p-12 text-center">
              <p className="text-destructive font-mono text-sm">Couldn't load software.</p>
              <Button variant="outline" size="sm" onClick={() => void router.invalidate()}>
                Retry
              </Button>
            </div>
          ) : result.value.software.length === 0 ? (
            <p className="text-muted-foreground p-12 text-center font-mono text-sm">
              No software in this view.
            </p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-sunken sticky top-0 z-10">
                  {COLUMNS.map((h, i) => (
                    <th
                      key={h || `col-${i}`}
                      className="text-muted-foreground border-border border-b p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.value.software.map((s, i) => (
                  <tr
                    key={s.softwareId}
                    className={i < result.value.software.length - 1 ? "border-border border-b" : ""}
                  >
                    <td className="text-foreground p-3 text-sm font-semibold">{s.title}</td>
                    <td className="text-muted-foreground p-3 font-mono text-xs">{s.slug}</td>
                    <td className="p-3">
                      <PublisherStatusBadge state={s.state} />
                    </td>
                    <td className="text-muted-foreground max-w-56 truncate p-3 font-mono text-xs">
                      {s.destinationUrl || "—"}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        to="/software/$softwareId"
                        params={{ softwareId: s.softwareId }}
                        className="text-primary font-mono text-xs underline-offset-4 hover:underline"
                      >
                        edit →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <Dialog open={open} onOpenChange={openDialog}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>New software</DialogTitle>
              <DialogDescription>
                Create a draft registry entry. It stays unpublished until you release it.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2">
              <Label htmlFor="new-title">Name</Label>
              <Input
                id="new-title"
                value={title}
                onChange={(e) => onTitle(e.target.value)}
                placeholder="Roadie"
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
                placeholder="roadie"
                required
              />
            </div>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>
                Cancel
              </DialogClose>
              <Button type="submit" disabled={busy || !title.trim() || !slug.trim()}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
