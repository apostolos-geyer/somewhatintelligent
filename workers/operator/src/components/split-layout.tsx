import type { ReactNode } from "react";
import { cn } from "@si/ui/lib/utils";

/**
 * Full-width two-column work surface: a wide main column and a narrower rail,
 * each owning its own vertical scroll on desktop (the route's frame must be a
 * non-scrolling `min-h-0` flex/grid ancestor). Below `lg` the columns stack
 * into one scroll region with the rail after the main content.
 */
export function SplitLayout({
  main,
  rail,
  railWidth = "24rem",
  className,
}: {
  main: ReactNode;
  rail: ReactNode;
  railWidth?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-0 flex-1 overflow-auto lg:grid lg:overflow-hidden",
        "lg:[grid-template-columns:minmax(0,1fr)_var(--rail-w)]",
        className,
      )}
      style={{ "--rail-w": railWidth } as React.CSSProperties}
    >
      {/* *:shrink-0 — children keep natural height so the COLUMN overflows and
          scrolls; without it flex children compress and clip their controls. */}
      <div className="flex min-h-0 flex-col gap-6 *:shrink-0 lg:overflow-y-auto lg:pr-6">
        {main}
      </div>
      <div className="mt-6 flex min-h-0 flex-col gap-6 *:shrink-0 lg:mt-0 lg:overflow-y-auto lg:border-l lg:border-border lg:pl-6">
        {rail}
      </div>
    </div>
  );
}
