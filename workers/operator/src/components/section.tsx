import type { ReactNode } from "react";
import { Card } from "@si/ui/components/card";
import { cn } from "@si/ui/lib/utils";

/**
 * Titled content card shared by every console module. `tone="default"` is the
 * proof-paper primary surface; reserve `tone="soft"` (dashed, quiet) for
 * secondary panels like danger zones and empty states.
 */
export function Section({
  title,
  actions,
  tone = "default",
  className,
  children,
}: {
  title: string;
  actions?: ReactNode;
  tone?: "default" | "soft";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card variant={tone === "soft" ? "soft" : "default"} className={cn("p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-foreground font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </Card>
  );
}
