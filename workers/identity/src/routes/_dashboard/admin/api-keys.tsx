import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@si/ui/components/table";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@si/ui/components/sheet";
import { getApiKeys } from "@/lib/admin.functions";

export const Route = createFileRoute("/_dashboard/admin/api-keys")({
  loader: () => getApiKeys(),
  head: () => ({ meta: [{ title: "API Keys — Admin" }] }),
  component: ApiKeysPage,
});

function ApiKeysPage() {
  const navigate = useNavigate();
  const { apiKeys } = Route.useLoaderData();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/admin" });
      }}
    >
      <SheetContent size="full">
        <SheetHeader>
          <SheetTitle>API Keys</SheetTitle>
          <p className="text-sm text-text-secondary">
            Every key someone made. Whether they should have is another matter.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <Table className="min-w-[600px]">
            <TableHeader>
              <TableRow className="border-b-[3px] border-border-strong bg-surface-sunken">
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeys.length === 0 && (
                <TableEmpty colSpan={5}>
                  No API keys yet. One would imagine that will change.
                </TableEmpty>
              )}
              {apiKeys.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="font-medium">{k.name ?? "Unnamed"}</TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">
                    {k.ownerEmail ?? "Unknown"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">
                    {k.prefix ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={k.enabled ? "success" : "secondary"}>
                      {k.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-text-tertiary">
                    {k.createdAt ? new Date(k.createdAt).toLocaleDateString("en-US") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SheetContent>
    </Sheet>
  );
}
