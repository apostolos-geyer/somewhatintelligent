import { Link, createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { Input } from "@si/ui/components/input";
import { Label } from "@si/ui/components/label";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
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
  const [error, setError] = useState<string | null>(null);

  function onTitle(value: string): void {
    setTitle(value);
    if (!slugEdited) setSlug(slugify(value));
  }

  async function submit(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const res = await createSoftware({
        data: { commandId: crypto.randomUUID(), slug: slug.trim(), title: title.trim() },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await navigate({ to: "/software/$softwareId", params: { softwareId: res.value.softwareId } });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-3xl font-light tracking-tight">Software</h1>
          <p className="text-muted-foreground mt-1 text-sm">Systems registry entries.</p>
        </div>
        <Button variant={open ? "outline" : "default"} onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "New entry"}
        </Button>
      </div>

      {open && (
        <Card variant="soft" className="mb-6 p-5">
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            {error && (
              <Alert variant="destructive">
                <AlertTitle>Couldn't create the entry</AlertTitle>
                <AlertDescription>{CREATE_ERROR[error] ?? error}</AlertDescription>
              </Alert>
            )}
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
            <div className="grid gap-2 sm:max-w-sm">
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
            <div>
              <Button type="submit" disabled={busy || !title.trim() || !slug.trim()}>
                {busy ? "Creating…" : "Create draft"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-2">
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

      {!result.ok ? (
        <Card variant="soft" className="p-8 text-center">
          <p className="text-destructive font-mono text-sm">Couldn't load software.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void router.invalidate()}
          >
            Retry
          </Button>
        </Card>
      ) : result.value.software.length === 0 ? (
        <Card variant="soft" className="text-muted-foreground p-12 text-center font-mono text-sm">
          No software in this view.
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-sunken">
                {["Name", "Slug", "Status", "Destination", ""].map((h) => (
                  <th
                    key={h}
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
        </Card>
      )}
    </div>
  );
}
