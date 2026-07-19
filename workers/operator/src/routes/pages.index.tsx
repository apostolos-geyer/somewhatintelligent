import { Link, createFileRoute } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { getPage } from "@/lib/pages.functions";
import { PAGE_KEYS, PAGE_KEY_LABELS } from "@/lib/page-forms";
import { formatDate } from "@/lib/format";

type PageRow = {
  key: (typeof PAGE_KEYS)[number];
  exists: boolean;
  activeVersion: string | null;
  updatedAt: number | null;
};

// Pages = the five fixed site page documents (RFC-0001 D9). Each is a versioned
// discriminated-union document; the operator edits declared copy/media/slots.
export const Route = createFileRoute("/pages/")({
  loader: async (): Promise<PageRow[]> => {
    const rows = await Promise.all(
      PAGE_KEYS.map(async (key): Promise<PageRow> => {
        const res = await getPage({ data: { key } });
        if (!res.ok) return { key, exists: false, activeVersion: null, updatedAt: null };
        return {
          key,
          exists: true,
          activeVersion: res.value.activeVersion,
          updatedAt: res.value.updatedAt,
        };
      }),
    );
    return rows;
  },
  component: PagesList,
});

function statusBadge(row: PageRow) {
  if (!row.exists) return <Badge variant="outline">Not created</Badge>;
  if (row.activeVersion) return <Badge variant="success">Published {row.activeVersion}</Badge>;
  return <Badge variant="warning">Draft</Badge>;
}

function PagesList() {
  const rows = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-foreground text-3xl font-light tracking-tight">Pages</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The five fixed site pages. Edit declared copy, media, and featured records.
        </p>
      </div>

      <Card className="overflow-hidden p-0">
        {rows.map((row, i) => (
          <Link
            key={row.key}
            to="/pages/$key"
            params={{ key: row.key }}
            className={
              "hover:bg-muted/50 flex items-center justify-between gap-4 p-4 transition-colors " +
              (i < rows.length - 1 ? "border-border border-b" : "")
            }
          >
            <div>
              <p className="text-foreground font-semibold">{PAGE_KEY_LABELS[row.key]}</p>
              <p className="text-muted-foreground font-mono text-xs">
                /{row.key === "home" ? "" : row.key}
                {row.updatedAt ? ` · updated ${formatDate(row.updatedAt)}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {statusBadge(row)}
              <span className="text-primary font-mono text-xs">edit →</span>
            </div>
          </Link>
        ))}
      </Card>
    </div>
  );
}
