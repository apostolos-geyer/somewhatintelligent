import { useState } from "react";
import { buttonVariants } from "@greenroom/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@greenroom/ui/components/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@greenroom/ui/components/alert-dialog";
import { cn } from "@greenroom/ui/lib/utils";

type Role = "owner" | "admin" | "member";

export function MemberActions({
  memberName,
  orgName,
  currentRole,
  isOnlyOwner,
  onChangeRole,
  onRemove,
}: {
  memberName: string;
  orgName: string;
  currentRole: Role;
  isOnlyOwner: boolean;
  onChangeRole: (next: Role) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const [removeOpen, setRemoveOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function confirmRemove() {
    setRemoving(true);
    try {
      await onRemove();
    } finally {
      setRemoving(false);
      setRemoveOpen(false);
    }
  }

  return (
    <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
          aria-label={`Actions for ${memberName}`}
        >
          ⋯
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Change role</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={currentRole === "owner"}
            onClick={() => void onChangeRole("owner")}
          >
            Owner
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={currentRole === "admin" || isOnlyOwner}
            onClick={() => void onChangeRole("admin")}
          >
            Admin
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={currentRole === "member" || isOnlyOwner}
            onClick={() => void onChangeRole("member")}
          >
            Member
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-text-stigma focus:text-text-stigma-hover"
            disabled={isOnlyOwner}
            onClick={() => setRemoveOpen(true)}
          >
            Remove from org
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {memberName}?</AlertDialogTitle>
          <AlertDialogDescription>
            They&apos;ll lose access to {orgName} immediately. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className={cn(buttonVariants({ variant: "ghost" }))}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            onClick={confirmRemove}
            disabled={removing}
          >
            {removing ? "Removing…" : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Subtree for DropdownMenuSub usage if we need it later (not used in v1).
// Exported for completeness but tree-shaken.
export const _internalSub = { DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent };
