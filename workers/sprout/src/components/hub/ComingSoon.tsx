import { useState, type ReactNode } from "react";
import { Clock, Eye, EyeOff } from "lucide-react";
import { FlipPreviewCard } from "@/components/hub/FlipPreviewCard";

/**
 * The honest "coming soon" treatment for a not-yet-wired Hub surface. By DEFAULT
 * it shows a clean coming-soon panel — NEVER fake data presented as real. The
 * sample (`children`) lives on the flip side and is only revealed on an explicit
 * "Preview a sample" click (3D flip via `FlipPreviewCard`), clearly captioned
 * "Sample preview — not live data". When the real read lands, drop the wrapper
 * and render `children` directly.
 */
export function ComingSoon({
  label,
  blurb,
  children,
}: {
  /** Names the surface for the a11y label, e.g. "Featured Content". */
  label: string;
  /** Optional one-liner on the front about what's coming. */
  blurb?: ReactNode;
  /** The sample preview, revealed behind the flip. */
  children: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <FlipPreviewCard
      revealed={revealed}
      front={
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-border bg-surface-raised px-6 py-7 text-center">
          <Clock className="size-5 text-muted-foreground" aria-hidden />
          {blurb && <p className="max-w-md text-sm text-muted-foreground">{blurb}</p>}
          <button
            type="button"
            onClick={() => setRevealed(true)}
            aria-expanded={revealed}
            aria-label={`Preview a sample of ${label}`}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout"
          >
            <Eye className="size-4" aria-hidden />
            Preview a sample
          </button>
        </div>
      }
      back={
        <div className="space-y-3 rounded-md border border-border bg-surface-raised p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium italic text-muted-foreground">
              Sample preview — not live data
            </span>
            <button
              type="button"
              onClick={() => setRevealed(false)}
              aria-expanded={revealed}
              aria-label={`Hide the ${label} sample`}
              className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sprout"
            >
              <EyeOff className="size-3.5" aria-hidden />
              Hide
            </button>
          </div>
          {children}
        </div>
      }
    />
  );
}
