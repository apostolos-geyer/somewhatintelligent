import { createFileRoute, useRouter, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@si/ui/components/avatar";
import { Badge } from "@si/ui/components/badge";
import { buttonVariants } from "@si/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@si/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@si/ui/components/alert-dialog";
import { toast } from "@si/ui/components/sonner";
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
import { cn } from "@si/ui/lib/utils";
import { authClient } from "@/lib/auth-client";
import { getUsers } from "@/lib/admin-users.functions";
import { isAdminRole } from "@si/kit/roles";

export const Route = createFileRoute("/_dashboard/admin/users")({
  loader: () => getUsers(),
  head: () => ({ meta: [{ title: "Users — Admin" }] }),
  component: UsersPage,
});

function UsersPage() {
  const navigate = useNavigate();
  const { users } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const currentUserId = session!.user.id;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) void navigate({ to: "/admin" });
      }}
    >
      <SheetContent size="full">
        <SheetHeader>
          <SheetTitle>Users</SheetTitle>
          <p className="text-sm text-text-secondary">
            Everyone who has, ostensibly, proven they exist.
          </p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow className="border-b-[3px] border-border-strong bg-surface-sunken">
                <TableHead className="w-12" />
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableEmpty colSpan={6}>
                  No users yet. One would imagine that will change.
                </TableEmpty>
              )}
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <Avatar size="sm">
                      {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                      <AvatarFallback>{u.name?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{u.name}</TableCell>
                  <TableCell className="font-mono text-xs text-text-tertiary">{u.email}</TableCell>
                  <TableCell>
                    <Badge variant={isAdminRole(u.role) ? "ink" : "secondary"}>
                      {u.role ?? "user"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.banned ? (
                      <Badge variant="rust">Banned</Badge>
                    ) : u.emailVerified ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="warning">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <UserActions
                      userId={u.id}
                      banned={u.banned ?? false}
                      currentUserId={currentUserId}
                    />
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

function UserActions({
  userId,
  banned,
  currentUserId,
}: {
  userId: string;
  banned: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleBan() {
    const result = banned
      ? await authClient.admin.unbanUser({ userId })
      : await authClient.admin.banUser({ userId });
    if (result.error) {
      toast.error(result.error.message ?? `Failed to ${banned ? "unban" : "ban"} user`);
      return;
    }
    toast.success(banned ? "User unbanned" : "User banned");
    await router.invalidate();
  }

  async function handleImpersonate() {
    const result = await authClient.admin.impersonateUser({ userId });
    if (result.error) {
      toast.error(result.error.message ?? "Failed to impersonate user");
      return;
    }
    await navigate({ to: "/" });
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await authClient.admin.removeUser({ userId });
    if (result.error) {
      toast.error(result.error.message ?? "Failed to delete user");
      setDeleting(false);
      return;
    }
    toast.success("User deleted");
    setDeleteOpen(false);
    await router.invalidate();
  }

  return (
    <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
          Actions
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleImpersonate}>Impersonate</DropdownMenuItem>
          <DropdownMenuItem onClick={handleBan}>{banned ? "Unban" : "Ban"}</DropdownMenuItem>
          {userId !== currentUserId && (
            <DropdownMenuItem
              className="text-text-rust focus:text-text-rust-hover"
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete User</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this user and all of their data. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting\u2026" : "Delete User"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
