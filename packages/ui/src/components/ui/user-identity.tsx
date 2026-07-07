// User identity surface for the platform nav. Mirrors the platform
// sidebar footer pattern (avatar + stacked name/email + trailing
// external-link icon) but adapted to the 52px horizontal nav.
// Authed → external link to the identity app's account page.
// Unauthed → compact Sign In button.
import { ExternalLinkIcon } from "lucide-react";

import { cn } from "@greenroom/ui/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./avatar";
import { Button } from "./button";

export type UserIdentityUser = {
  name: string;
  email: string | null;
  image?: string | null;
};

function initialsFor(user: UserIdentityUser): string {
  const source = user.name.trim() || (user.email ?? "").trim() || "?";
  // Prefer "AB" from a two-word name; otherwise first two chars.
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function UserIdentity({
  user,
  accountHref,
  signInHref,
  compact = true,
  className,
}: {
  user: UserIdentityUser | null;
  accountHref: string;
  signInHref: string;
  // When true, hide name/email below md breakpoint — only the avatar +
  // external-link icon remain visible. Default: true (nav is tight).
  compact?: boolean;
  className?: string;
}) {
  if (!user) {
    return (
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        className={cn("type-mono-label gap-1.5 border-border-strong", className)}
        render={<a href={signInHref} />}
      >
        Sign in
      </Button>
    );
  }

  const initials = initialsFor(user);

  return (
    <a
      href={accountHref}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Open Platform account"
      className={cn(
        "group flex h-9 items-center gap-2.5 rounded-sm border border-border bg-surface px-2 pr-2.5 text-left no-underline transition-colors hover:border-border-strong hover:bg-surface-raised",
        className,
      )}
    >
      <Avatar size="sm">
        {user.image ? <AvatarImage src={user.image} /> : null}
        <AvatarFallback className="rounded-sm text-[10px] font-semibold">{initials}</AvatarFallback>
      </Avatar>
      <div
        className={cn(
          "grid min-w-0 flex-1 text-left leading-tight",
          compact ? "hidden md:grid" : "grid",
        )}
      >
        <span className="text-foreground truncate text-xs font-semibold">{user.name}</span>
        {user.email ? (
          <span className="text-text-tertiary truncate text-[10px]">{user.email}</span>
        ) : null}
      </div>
      <ExternalLinkIcon className="text-text-tertiary size-3.5" aria-hidden />
    </a>
  );
}
