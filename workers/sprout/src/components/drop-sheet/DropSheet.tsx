import { useEffect, useState } from "react";
import { Sprout } from "lucide-react";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import { listLineup, type LineupGroup } from "@/lib/drops.functions";
import { ProductCard } from "./ProductCard";
import { ProductDetail } from "./ProductDetail";

/**
 * The Drop Sheet — the "CURRENT LINEUP" board that sits BELOW the section grid on
 * the portal page `/` (it is NOT a section layer; it lives on the page directly).
 * Each category becomes a horizontally-scrollable strip of product cards; tapping
 * a card flips `?item=<productId>` to mount the ProductDetail Sheet/Drawer over the
 * page (the grid + sheet never remount). Reads the published lineup via the gated
 * `listLineup` in a useEffect (client-mounted, not a route loader), re-loading when
 * the active brand changes.
 *
 * Empty (no published products) → renders nothing, so a brand without a lineup
 * just shows the section grid. Loading → a couple of skeleton strips.
 */
export function DropSheet({ brandKey }: { brandKey?: string }) {
  const { section, item, setItem } = useLayerStack();
  const [groups, setGroups] = useState<LineupGroup[] | null>(null);

  // `?item=` is shared with the section layers (e.g. the assets viewer deep-link).
  // The product detail must ONLY open when no section layer is active, so a
  // section's item id never mounts a phantom product sheet behind the layer.
  const detailProductId = section === null ? item : null;

  useEffect(() => {
    let cancelled = false;
    setGroups(null);
    void (async () => {
      try {
        const rows = await listLineup();
        if (!cancelled) setGroups(rows);
      } catch {
        if (!cancelled) setGroups([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandKey]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (groups === null) {
    return (
      <section className="mt-10 space-y-6">
        <LineupHeading />
        {[0, 1].map((g) => (
          <div key={g} className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <div className="flex gap-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-60 w-44 shrink-0 rounded-sm sm:w-52" />
              ))}
            </div>
          </div>
        ))}
      </section>
    );
  }

  // ── Empty: render nothing (just the grid above stays) ──────────────────────
  if (groups.length === 0) return null;

  // ── Lineup ─────────────────────────────────────────────────────────────────
  return (
    <>
      <section className="mt-10 space-y-8">
        <LineupHeading />
        {groups.map((group) => (
          <div key={group.category} className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.category}
            </h3>
            <div
              role="list"
              aria-label={`${group.category} products`}
              className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:thin]"
            >
              {group.products.map((product) => (
                <ProductCard key={product.id} product={product} onOpen={setItem} />
              ))}
            </div>
          </div>
        ))}
      </section>

      {detailProductId && (
        <ProductDetail productId={detailProductId} onClose={() => setItem(undefined)} />
      )}
    </>
  );
}

function LineupHeading() {
  return (
    <div className="space-y-1.5">
      {/* The spec's `// CURRENT LINEUP` mono kicker (type-mono-label) above the
          display-font heading — mirrors the section-grid's monospace labelling. */}
      <p className="type-mono-label text-muted-foreground">// CURRENT LINEUP</p>
      <div className="flex items-center gap-2">
        <Sprout className="size-5 text-primary" aria-hidden />
        <h2 className="font-display text-xl font-bold tracking-tight">Current lineup</h2>
      </div>
    </div>
  );
}
