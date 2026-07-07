import { Link, useNavigate } from "@tanstack/react-router";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@greenroom/ui/components/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@greenroom/ui/components/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@greenroom/ui/components/avatar";
import { ChevronsUpDownIcon } from "lucide-react";
import { toast } from "@greenroom/ui/components/sonner";
import { authClient } from "@/lib/auth-client";
import { isAdminRole } from "@greenroom/kit/roles";

type User = {
  name: string;
  email: string;
  role: string | null;
  image: string | null;
};

export function SidebarUserMenu({ user }: { user: User }) {
  const navigate = useNavigate();

  async function handleSignOut() {
    const result = await authClient.signOut();
    if (result.error) {
      toast.error(result.error.message ?? "Failed to sign out");
      return;
    }
    void navigate({ to: "/sign-in" });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
            <Avatar size="sm">
              {user.image ? <AvatarImage src={user.image} alt="" /> : null}
              <AvatarFallback>{user.name?.charAt(0).toUpperCase() ?? "?"}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs text-text-tertiary">{user.email}</span>
            </div>
            <ChevronsUpDownIcon className="ml-auto size-4" />
          </DropdownMenuTrigger>

          <DropdownMenuContent side="top" sideOffset={4}>
            <DropdownMenuGroup>
              <DropdownMenuLabel>{user.name}</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem render={<Link to="/account" />}>Account</DropdownMenuItem>
              {isAdminRole(user.role) && (
                <DropdownMenuItem render={<Link to="/admin" />}>Admin</DropdownMenuItem>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
