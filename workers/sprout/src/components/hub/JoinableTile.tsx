import { Check } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { BrandMark, BrandWash } from "@/components/hub/tile-brand";
import type { JoinableBrand } from "@/lib/hub.functions";

/**
 * One "Brands you can join" tile. The budtender taps "Request Access" to queue a
 * join request; the parent grid flips `requested` optimistically (and on a failed
 * request rolls it back), so this tile is presentational — it renders the brand
 * mark (logo/initial on the brand's colour wash, same treatment as the member
 * tiles) + name and either the action Button or a disabled "Requested" badge. The
 * Button shows a pending state while the mutation is in flight to prevent a
 * double-submit (the queue is also `ON CONFLICT DO NOTHING` server-side, so a
 * race can never double-queue).
 */
export function JoinableTile({
  brand,
  requested,
  pending,
  onRequest,
}: {
  brand: JoinableBrand;
  requested: boolean;
  pending: boolean;
  onRequest: () => void;
}) {
  return (
    <Card
      className={cn(
        "relative flex h-full flex-row items-center gap-4 overflow-hidden p-4",
        surfaceMaterials.brutal,
      )}
    >
      <BrandWash accent={brand.accent} />
      <BrandMark name={brand.name} logoUrl={brand.logoUrl} accent={brand.accent} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display font-bold" title={brand.name}>
          {brand.name}
        </p>
        <p className="truncate text-xs text-muted-foreground">{brand.slug}.sproutportal</p>
      </div>
      {requested ? (
        <Badge variant="soft" size="sm" className="shrink-0 gap-1">
          <Check className="size-3" aria-hidden />
          Requested
        </Badge>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={onRequest}
          className="shrink-0"
        >
          {pending ? "Requesting…" : "Request Access"}
        </Button>
      )}
    </Card>
  );
}
