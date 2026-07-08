// Shared app shell: the PlatformNav top bar plus a FAB that opens a
// dropdown-menu-style command list for navigation. Extends `platform-nav.tsx`
// rather than forking it — the 52px bar, safe-area handling, and app-switcher
// dropdown are reused verbatim; this file only adds the title slot and the
// FAB nav, so identity and store end up on the exact same shell instead of
// two hand-rolled headers.
import * as React from "react";
import { MenuIcon } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@si/ui/lib/utils";
import { PlatformNav } from "./platform-nav";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

// ── Root ──────────────────────────────────────────────────────────

function AppFrameRoot({ children, className, style }: React.ComponentProps<typeof PlatformNav>) {
  return (
    <PlatformNav className={className} style={style}>
      {children}
    </PlatformNav>
  );
}

// ── Title slot ────────────────────────────────────────────────────
// Plain slot for page context (e.g. a breadcrumb) — still needed for "where
// am I" wayfinding even once page content is overlay-driven.

function AppFrameTitle({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center gap-2 truncate text-sm", className)}>
      {children}
    </div>
  );
}

// ── FAB nav ───────────────────────────────────────────────────────
// Replaces both the persistent sidebar's nav links and its user-menu chip
// with one floating trigger + grouped dropdown, modeled on the existing
// sidebar-user-menu.tsx shape (user header, then link groups, then sign out).

export type FabMenuItem = { href: string; label: string; icon?: LucideIcon };
export type FabMenuGroup = { label?: string; items: FabMenuItem[] };

function AppFrameFab({
  groups,
  user,
  onSignOut,
  linkComponent,
  className,
}: {
  groups: FabMenuGroup[];
  user?: { name: string; email: string };
  onSignOut?: () => void;
  linkComponent?: React.ElementType;
  className?: string;
}) {
  const InternalLink = linkComponent ?? "a";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Navigation menu"
            className={cn(
              "fixed bottom-6 left-6 z-40 flex size-14 items-center justify-center rounded-full border-2 border-border-strong bg-ink text-background shadow-brutal-md transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-brutal-lg active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
              className,
            )}
          />
        }
      >
        <MenuIcon className="size-6" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" side="top" sideOffset={12} className="min-w-[220px]">
        {user && (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel className="flex flex-col gap-0.5 py-1.5">
                <span className="text-sm font-semibold text-foreground">{user.name}</span>
                <span className="text-xs text-text-tertiary">{user.email}</span>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        )}

        {groups.map((group, i) => (
          <React.Fragment key={group.label ?? i}>
            <DropdownMenuGroup>
              {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
              {group.items.map((item) => (
                <DropdownMenuItem
                  key={item.href}
                  className="gap-2.5"
                  render={<InternalLink href={item.href} to={item.href} />}
                >
                  {item.icon ? <item.icon className="size-4" /> : null}
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </React.Fragment>
        ))}

        {onSignOut && (
          <DropdownMenuGroup>
            <DropdownMenuItem variant="destructive" onClick={onSignOut}>
              Sign Out
            </DropdownMenuItem>
          </DropdownMenuGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── Export as compound ────────────────────────────────────────────

type AppFrameComponent = typeof AppFrameRoot & {
  Brand: typeof PlatformNav.AppSwitcher;
  Title: typeof AppFrameTitle;
  Right: typeof PlatformNav.Right;
  Fab: typeof AppFrameFab;
};

export const AppFrame = AppFrameRoot as AppFrameComponent;
AppFrame.Brand = PlatformNav.AppSwitcher;
AppFrame.Title = AppFrameTitle;
AppFrame.Right = PlatformNav.Right;
AppFrame.Fab = AppFrameFab;
