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
  const { users } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const currentUserId = session!.user.id;

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-section">
        <h1 className="type-page-title">Users</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Everyone who has, ostensibly, proven they exist.
        </p>
      </div>

      <div className="flex-1 overflow-x-auto rounded-sm border-2 border-border-strong">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-border-strong bg-surface-sunken">
              <th className="w-12 px-4 py-3" />
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Name
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Email
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Role
              </th>
              <th className="type-mono-label px-4 py-3 text-left font-normal text-text-tertiary">
                Status
              </th>
              <th className="px-4 py-3 text-right" />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-text-tertiary">
                  No users yet. One would imagine that will change.
                </td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Avatar size="sm">
                    {u.image ? <AvatarImage src={u.image} alt="" /> : null}
                    <AvatarFallback>{u.name?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
                  </Avatar>
                </td>
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-text-tertiary">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={isAdminRole(u.role) ? "sprout" : "secondary"}>
                    {u.role ?? "user"}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {u.banned ? (
                    <Badge variant="stigma">Banned</Badge>
                  ) : u.emailVerified ? (
                    <Badge variant="growth">Active</Badge>
                  ) : (
                    <Badge variant="pistil">Pending</Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <UserActions
                    userId={u.id}
                    banned={u.banned ?? false}
                    currentUserId={currentUserId}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
              className="text-text-stigma focus:text-text-stigma-hover"
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
