import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { HubSectionHeader } from "@/components/hub/HubSectionHeader";
import { ComingSoon } from "@/components/hub/ComingSoon";

/**
 * A Hub "featured ___" section: a titled header (with a Coming-soon badge) over a
 * horizontally snap-scrolling row of cards. The row is NOT shown by default — it
 * lives behind the `ComingSoon` flip (honest empty state + opt-in sample preview),
 * since there's no platform-curated content model wired yet. When a
 * `getFeatured*` read lands, drop `ComingSoon` and render the scroller directly.
 */
export function FeaturedCarousel({
  icon,
  title,
  subtitle,
  blurb,
  children,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  /** Front-of-flip one-liner about what's coming. */
  blurb?: ReactNode;
  /** The sample cards (each `shrink-0 snap-start` with a fixed width). */
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <HubSectionHeader
        icon={icon}
        title={title}
        subtitle={subtitle}
        badge={
          <Badge variant="warn" className="gap-1">
            <Clock className="size-3" aria-hidden />
            Coming soon
          </Badge>
        }
      />
      <ComingSoon label={title} blurb={blurb}>
        {/* Edge-bleed so the first/last card's focus ring isn't clipped; thin
            scrollbar + snap for a native horizontal-scroll feel. */}
        <div
          className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
          role="list"
        >
          {children}
        </div>
      </ComingSoon>
    </section>
  );
}
