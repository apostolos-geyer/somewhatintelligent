import { cn } from "@si/ui/lib/utils";

// A layout-owned divider, not a component-owned border: it breaks out of
// whatever centered/max-width column it's placed in and spans the full
// viewport width (or, with orientation="vertical", the full height of its
// positioned ancestor). Use this BETWEEN parent-layout sections instead of
// letting each child draw its own edge — the line belongs to the row/column
// gap, not to either neighbor.
function GridLine({
  orientation = "horizontal",
  className,
}: {
  orientation?: "horizontal" | "vertical";
  className?: string;
}) {
  if (orientation === "vertical") {
    return (
      <div
        aria-hidden
        className={cn("absolute inset-y-0 w-px border-l-2 border-dashed border-border", className)}
      />
    );
  }
  return (
    <div aria-hidden className={cn("relative h-px w-full", className)}>
      <div className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 border-t-2 border-dashed border-border" />
    </div>
  );
}

export { GridLine };
