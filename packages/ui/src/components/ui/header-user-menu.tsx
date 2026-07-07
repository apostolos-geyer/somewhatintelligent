"use client";

import { ExternalLinkIcon, LogOutIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface HeaderUserMenuProps {
  user: { name: string; email: string; image?: string | null };
  idpAccountUrl?: string;
  onSignOut?: () => Promise<void> | void;
  children?: React.ReactNode;
}

export function HeaderUserMenu({ user, idpAccountUrl, onSignOut, children }: HeaderUserMenuProps) {
  const handleSignOut = async () => {
    if (onSignOut) {
      await onSignOut();
      return;
    }
    console.warn(
      "HeaderUserMenu: no onSignOut handler provided — sign-out is a no-op. Every consumer must pass onSignOut backed by its app's auth client.",
    );
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-sprout">
        <Avatar className="size-8 rounded-sm">
          <AvatarImage src={user.image ?? undefined} />
          <AvatarFallback className="rounded-sm text-xs">
            {user.name.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <div className="px-2 py-1.5">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-text-tertiary">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        {children}
        {idpAccountUrl && (
          <DropdownMenuItem
            render={<a href={idpAccountUrl} target="_blank" rel="noopener noreferrer" />}
          >
            Platform Account
            <ExternalLinkIcon className="ml-auto size-3.5 text-text-tertiary" />
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOutIcon className="size-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
