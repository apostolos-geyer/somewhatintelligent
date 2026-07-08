import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
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
import { getSessions } from "@/lib/admin-sessions.functions";

export const Route = createFileRoute("/_dashboard/admin/sessions")({
  loader: () => getSessions(),
  head: () => ({ meta: [{ title: "Sessions — Admin" }] }),
  component: SessionsPage,
});

function SessionsPage() {
  const navigate = useNavigate();
  const { sessions } = Route.useLoaderData();

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/admin" });
      }}
    >
      <SheetContent size="full">
        <SheetHeader>
          <SheetTitle>Sessions</SheetTitle>
          <p className="text-sm text-text-secondary">
            Active sessions. Each one a small thread of trust, held open until it expires or is
            revoked.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <Table className="min-w-[700px]">
            <TableHeader>
              <TableRow className="border-b-2 border-border-strong bg-surface-sunken">
                <TableHead>User</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Expires</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 && (
                <TableEmpty colSpan={4}>
                  No active sessions. It follows that nobody is currently authenticated.
                </TableEmpty>
              )}
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar size="sm">
                        {s.userImage ? <AvatarImage src={s.userImage} alt="" /> : null}
                        <AvatarFallback>
                          {s.userName?.charAt(0).toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{s.userName ?? "Unknown"}</div>
                        <div className="font-mono text-xs text-text-tertiary">{s.userEmail}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">
                    {s.ipAddress ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">
                    {s.createdAt ? new Date(s.createdAt).toLocaleDateString("en-US") : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">
                    {s.expiresAt ? new Date(s.expiresAt).toLocaleDateString("en-US") : "—"}
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
