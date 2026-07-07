import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Card } from "@greenroom/ui/components/card";
import { interactiveMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import type { SectionKey } from "@/lib/sections";

export interface BannerCardData {
  id: string;
  categoryTag?: string | null;
  headline: string;
  line: string;
  /** In-platform link only — opens a section layer. NEVER an external URL. */
  section?: SectionKey | null;
  item?: string | null;
  dismissible: boolean;
}

/**
 * Persistent banner rail — side columns on desktop, a horizontal top strip on
 * mobile. Mounted in the shell so it survives section-layer open/close. Cards
 * link ONLY into sections (`openLayer`), never out of the platform.
 *
 * Impressions are first-paint, not mount: an IntersectionObserver fires
 * `onImpression(id)` exactly once per card the first time it actually enters the
 * viewport (a banner scrolled past on mobile never counts until seen). Clicks
 * (`onOpen`) and dismissals (`onDismiss`) are owned by the stateful shell wrapper.
 */
export function BannerRail({
  banners,
  onOpen,
  onDismiss,
  onImpression,
  className,
}: {
  banners: BannerCardData[];
  onOpen?: (section: SectionKey, item?: string) => void;
  onDismiss?: (bannerId: string) => void;
  onImpression?: (bannerId: string) => void;
  className?: string;
}) {
  // One IntersectionObserver for the whole rail; each card registers its node
  // (keyed by banner id via data-banner-id). Fires once per card, then unobserves.
  const seen = useRef<Set<string>>(new Set());
  const onImpressionRef = useRef(onImpression);
  onImpressionRef.current = onImpression;
  const nodes = useRef<Map<string, HTMLElement>>(new Map());
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = (entry.target as HTMLElement).dataset.bannerId;
          if (!id || seen.current.has(id)) continue;
          seen.current.add(id);
          observer.unobserve(entry.target);
          onImpressionRef.current?.(id);
        }
      },
      { threshold: 0.5 },
    );
    observerRef.current = observer;
    for (const node of nodes.current.values()) observer.observe(node);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const registerNode = (id: string) => (node: HTMLElement | null) => {
    if (node) {
      nodes.current.set(id, node);
      if (!seen.current.has(id)) observerRef.current?.observe(node);
    } else {
      const existing = nodes.current.get(id);
      if (existing) observerRef.current?.unobserve(existing);
      nodes.current.delete(id);
    }
  };

  if (banners.length === 0) return null;
  return (
    <div className={cn("flex flex-row gap-3 lg:flex-col", className)}>
      {banners.map((b) => (
        <Card
          key={b.id}
          ref={registerNode(b.id)}
          data-banner-id={b.id}
          variant="soft"
          className={cn("relative w-full p-4", b.section && interactiveMaterials.brutal)}
          role={b.section ? "button" : undefined}
          tabIndex={b.section ? 0 : undefined}
          onClick={b.section ? () => onOpen?.(b.section!, b.item ?? undefined) : undefined}
        >
          {b.categoryTag ? (
            <Badge variant="sprout" className="mb-2">
              {b.categoryTag}
            </Badge>
          ) : null}
          <p className="font-medium">{b.headline}</p>
          {b.line ? <p className="text-sm text-muted-foreground">{b.line}</p> : null}
          {b.dismissible ? (
            <button
              type="button"
              aria-label="Dismiss"
              onClick={(e) => {
                e.stopPropagation();
                onDismiss?.(b.id);
              }}
              className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
