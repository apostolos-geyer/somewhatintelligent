import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
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
import { isManaged } from "@/lib/clients";
import { getClients } from "@/lib/admin-clients.functions";
import { GridLine } from "@si/ui/components/grid-line";

export const Route = createFileRoute("/_dashboard/admin/clients")({
  loader: () => getClients(),
  head: () => ({ meta: [{ title: "OAuth Clients — Admin" }] }),
  component: ClientsPage,
});

// The list renders unconditionally as the persistent background; `$id` and
// `new` match into the `Outlet` below and render themselves inside a Sheet.
function ClientsPage() {
  const { clients } = Route.useLoaderData();

  return (
    <div className="relative flex flex-1 flex-col">
      <GridLine orientation="vertical" className="left-0" />
      <GridLine orientation="vertical" className="right-0" />

      <div className="mb-section flex items-baseline justify-between">
        <div>
          <p className="mt-1 text-sm text-text-secondary">
            The applications that have been granted the privilege of asking you who you are.
          </p>
        </div>
        <Link to="/admin/clients/new">
          <Button size="sm">Add Client</Button>
        </Link>
      </div>

      <GridLine className="mb-section" />

      <Table className="min-w-[700px]">
        <TableHeader>
          <TableRow className="border-b-[3px] border-border-strong bg-surface-sunken">
            <TableHead>Name</TableHead>
            <TableHead>Client ID</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {clients.length === 0 && (
            <TableEmpty colSpan={4}>
              No clients registered. The identity provider awaits its supplicants.
            </TableEmpty>
          )}
          {clients.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link
                  to="/admin/clients/$id"
                  params={{ id: c.id }}
                  className="font-medium hover:text-primary"
                >
                  {c.name ?? c.clientId}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-xs text-text-tertiary">{c.clientId}</TableCell>
              <TableCell>
                <Badge variant="secondary">{c.type ?? "web"}</Badge>
              </TableCell>
              <TableCell>
                {isManaged(c.referenceId) ? (
                  <Badge variant="warning">Managed</Badge>
                ) : (
                  <Badge variant="ink">Custom</Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Outlet />
    </div>
  );
}
