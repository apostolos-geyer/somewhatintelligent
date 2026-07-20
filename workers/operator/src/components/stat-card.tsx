/**
 * Overview stat tile (RFC-0001 wave-1 UX). A presentational `Card` showing a
 * headline count and label; wrap it in a router `Link` to make the whole tile a
 * jump to a filtered list. No COUNT(*) RPC exists, so counts are the capped
 * recent-list length rendered honestly ("5+" at the limit) by the caller.
 */
import type { ReactNode } from "react";
import { Card } from "@si/ui/components/card";

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <Card className="hover:border-border-strong h-full gap-2 p-5 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
          {label}
        </span>
        {icon && <span className="text-muted-foreground/70 [&>svg]:size-4">{icon}</span>}
      </div>
      <div className="text-foreground text-3xl font-light tabular-nums">{value}</div>
      {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
    </Card>
  );
}
