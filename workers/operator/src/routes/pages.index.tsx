import { Link, createFileRoute } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { PageHeader } from "@/components/page-header";
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
  if (!row.exists)
    return (
      <Badge variant="outline" size="sm">
        Not created
      </Badge>
    );
  if (row.activeVersion)
    return (
      <Badge variant="success" size="sm">
        Published {row.activeVersion}
      </Badge>
    );
  return (
    <Badge variant="warning" size="sm">
      Draft
    </Badge>
  );
}

/** Public route path a page document renders to (`home` is the apex). */
function pagePath(key: PageRow["key"]): string {
  return key === "home" ? "/" : `/${key}`;
}

function PagesList() {
  const rows = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader
        eyebrow="Site content"
        title="Pages"
        subtitle="The five fixed site pages. Edit declared copy, media, and featured records."
      />

      <Card className="flex flex-col gap-0 overflow-hidden p-0 lg:min-h-0 lg:flex-1">
        <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
          <h2 className="text-foreground font-medium">Documents</h2>
          <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
            {rows.length} fixed pages
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-sunken">
                {["Page", "Path", "Status", "Updated", ""].map((h) => (
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
              {rows.map((row, i) => (
                <tr
                  key={row.key}
                  className={
                    "hover:bg-muted/50 transition-colors " +
                    (i < rows.length - 1 ? "border-border border-b" : "")
                  }
                >
                  <td className="p-3">
                    <Link
                      to="/pages/$key"
                      params={{ key: row.key }}
                      className="text-foreground text-sm font-semibold underline-offset-4 hover:underline"
                    >
                      {PAGE_KEY_LABELS[row.key]}
                    </Link>
                  </td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">
                    {pagePath(row.key)}
                  </td>
                  <td className="p-3">{statusBadge(row)}</td>
                  <td className="text-muted-foreground p-3 font-mono text-xs">
                    {row.updatedAt ? formatDate(row.updatedAt) : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      to="/pages/$key"
                      params={{ key: row.key }}
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
    </div>
  );
}
