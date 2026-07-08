import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Button } from "@si/ui/components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@si/ui/components/table";
import { listOrgsForAdmin } from "@/lib/org-admin.functions";
import { relativeTime } from "@/lib/relative-time";

export const Route = createFileRoute("/_dashboard/admin/orgs")({
  loader: () => listOrgsForAdmin(),
  head: () => ({ meta: [{ title: "Organizations — Admin" }] }),
  component: OrgsPage,
});

// The list renders unconditionally as the persistent background; `$id` and
// `new` match into the `Outlet` below and render themselves inside a Sheet.
function OrgsPage() {
  const { orgs } = Route.useLoaderData();

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section flex items-baseline justify-between">
        <div>
          <p className="mt-1 text-sm text-text-secondary">
            The customer brands provisioned on this platform. Each is its own tenant of the identity
            apparatus.
          </p>
        </div>
        <Link to="/admin/orgs/new">
          <Button size="sm">+ New organization</Button>
        </Link>
      </div>

      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow className="border-b-2 border-border-strong bg-surface-sunken">
            <TableHead>Slug</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Members</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Owner</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs.length === 0 && (
            <TableEmpty colSpan={5}>
              No organizations yet.{" "}
              <Link to="/admin/orgs/new" className="text-primary hover:underline">
                Onboard your first brand →
              </Link>
            </TableEmpty>
          )}
          {orgs.map((o) => (
            <TableRow key={o.id}>
              <TableCell>
                <Link
                  to="/admin/orgs/$id"
                  params={{ id: o.id }}
                  className="font-mono text-xs hover:text-primary"
                >
                  {o.slug}
                </Link>
              </TableCell>
              <TableCell className="font-medium">{o.name}</TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary">
                {o.memberCount}
              </TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary">
                {relativeTime(o.createdAt)}
              </TableCell>
              <TableCell className="text-sm">
                {o.ownerName ?? <span className="text-text-tertiary">—</span>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Outlet />
    </div>
  );
}
