import type { ReactNode } from "react";
import { cn } from "@si/ui/lib/utils";

/**
 * Route header row: optional mono eyebrow (breadcrumb/back slot), title,
 * subtitle, and a right-aligned actions cluster. Non-scrolling (`shrink-0`) so
 * it stays pinned above a route's scrolling panels.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex shrink-0 items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-muted-foreground mb-1 font-mono text-[10px] uppercase tracking-wider">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-foreground truncate text-2xl font-light tracking-tight">{title}</h1>
        {subtitle ? <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
