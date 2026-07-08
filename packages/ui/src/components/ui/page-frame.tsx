import * as React from "react";

import { cn } from "@si/ui/lib/utils";

// The Tailwind-site move: vertical rules that bound the content column and
// run CONTINUOUSLY the full height of the page — not per-card borders that
// break up between sections. Small "+" registration marks sit at the four
// corners, echoing the drafting mark in the wordmark. Wrap the whole page's
// content in this once, at the layout level; individual cards inside keep
// their own dashed borders too, so the frame reads as the outermost ruled
// line and the cards as the inner ones — same grammar, different scale.
function PageFrame({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("relative mx-auto w-full max-w-content flex-1", className)} {...props}>
      <CornerMark className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2" />
      <CornerMark className="absolute top-0 right-0 translate-x-1/2 -translate-y-1/2" />
      <div className="min-h-full border-x-2 border-dashed border-border">{children}</div>
      <CornerMark className="absolute bottom-0 left-0 -translate-x-1/2 translate-y-1/2" />
      <CornerMark className="absolute right-0 bottom-0 translate-x-1/2 translate-y-1/2" />
    </div>
  );
}

function CornerMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      width="9"
      height="9"
      viewBox="0 0 9 9"
      className={cn("pointer-events-none z-10 text-border", className)}
    >
      <path d="M4.5 0V9M0 4.5H9" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export { PageFrame };
