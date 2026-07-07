import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@greenroom/ui/lib/utils";

/**
 * The shared Hub section header — display-`h2` + icon + optional subtitle, with an
 * optional right-aligned slot (e.g. a "Coming soon" badge). Extracted so every Hub
 * section (Featured*, Poll, …) shares one heading rhythm and the coming-soon
 * treatment can't drift between them.
 */
export function HubSectionHeader({
  icon: Icon,
  title,
  subtitle,
  badge,
  className,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** Optional right-aligned node (status badge, action). */
  badge?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-2", className)}>
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <Icon className="size-6 text-primary" aria-hidden />
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {badge && <div className="shrink-0">{badge}</div>}
    </header>
  );
}
