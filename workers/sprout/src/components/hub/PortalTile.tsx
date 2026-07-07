import { ArrowUpRight } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { BrandMark, BrandWash } from "@/components/hub/tile-brand";
import type { PortalSummary } from "@/lib/hub.functions";

/**
 * One "Your Portals" tile — a brand the budtender is a member of. Tapping it
 * navigates CROSS-HOST to that brand's portal (`portalUrl` = `<slug>.<apex>`,
 * computed server-side from the directory slug, never client input), so this is a
 * plain `<a>` to a full origin rather than a typed in-app `<Link>`. The tile wears
 * the brand's own identity — its uploaded logo (or initial) on a faint wash of the
 * brand's colour ("faded with brand colour to fit in") — plus an unread-count
 * Badge when there's at least one unread notification for that brand.
 */
export function PortalTile({ portal }: { portal: PortalSummary }) {
  return (
    <a
      href={portal.portalUrl}
      className="group/tile block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sprout"
      aria-label={`Open ${portal.name}${
        portal.unreadCount > 0 ? `, ${portal.unreadCount} unread` : ""
      }`}
    >
      <Card
        variant="soft"
        className={cn(
          "relative flex h-full flex-row items-center gap-4 overflow-hidden p-4",
          interactiveMaterials.brutal,
        )}
      >
        <BrandWash accent={portal.accent} />
        <BrandMark name={portal.name} logoUrl={portal.logoUrl} accent={portal.accent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display font-bold" title={portal.name}>
              {portal.name}
            </p>
            {portal.unreadCount > 0 && (
              <Badge variant="sprout" size="sm" className="shrink-0 tabular-nums">
                {portal.unreadCount > 99 ? "99+" : portal.unreadCount}
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">{portal.slug}.sproutportal</p>
        </div>
        <ArrowUpRight
          className="size-5 shrink-0 text-muted-foreground transition-colors group-hover/tile:text-primary"
          aria-hidden
        />
      </Card>
    </a>
  );
}
