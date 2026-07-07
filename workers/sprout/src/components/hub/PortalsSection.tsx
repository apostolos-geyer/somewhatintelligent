import { useState } from "react";
import { Compass, LayoutGrid, Sparkles } from "lucide-react";
import { PortalTile } from "@/components/hub/PortalTile";
import { JoinableTile } from "@/components/hub/JoinableTile";
import { requestAccess, type JoinableBrand, type PortalSummary } from "@/lib/hub.functions";

/**
 * Hub component #1 (the wireframe's most prominent block) — "Your Portals" + the
 * "Portals you can join" sub-grid. Presentational shell over the two tile grids;
 * both reads are gated + caller-scoped upstream (`listMyPortals` returns only the
 * caller's memberships joined to unread counts; `listJoinableBrands` returns the
 * public directory MINUS memberships and pending requests). Requesting access
 * flips the tile optimistically to a disabled "Requested" badge; the queue is
 * `ON CONFLICT DO NOTHING`, so a failed/raced request can never double-queue.
 */
export function PortalsSection({
  portals,
  joinable,
}: {
  portals: PortalSummary[];
  joinable: JoinableBrand[];
}) {
  return (
    <section className="flex flex-col gap-section">
      <YourPortals portals={portals} />
      <JoinableBrands joinable={joinable} />
    </section>
  );
}

function YourPortals({ portals }: { portals: PortalSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <LayoutGrid className="size-6 text-primary" aria-hidden />
          Your Portals
        </h2>
        <p className="text-sm text-muted-foreground">
          Every brand you belong to. Tap one to open its budtender portal.
        </p>
      </header>

      {portals.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-border py-16 text-center">
          <Sparkles className="size-8 text-muted-foreground" aria-hidden />
          <p className="max-w-sm text-sm text-muted-foreground">
            You're not a member of any portals yet. Request access to a brand below to get started.
          </p>
        </div>
      ) : (
        <div className="grid gap-grid sm:grid-cols-2">
          {portals.map((portal) => (
            <PortalTile key={portal.orgId} portal={portal} />
          ))}
        </div>
      )}
    </div>
  );
}

function JoinableBrands({ joinable }: { joinable: JoinableBrand[] }) {
  // Optimistic request set: a brand id flips into `requested` the instant the
  // budtender taps, and rolls back if the queue write fails. `pending` blocks a
  // double-submit while the request is in flight.
  const [requested, setRequested] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  async function handleRequest(brandId: string) {
    if (requested.has(brandId) || pending.has(brandId)) return;
    setPending((prev) => new Set(prev).add(brandId));
    setRequested((prev) => new Set(prev).add(brandId));
    try {
      await requestAccess({ data: { brandId } });
    } catch {
      // Roll the optimistic flip back so the budtender can retry.
      setRequested((prev) => {
        const next = new Set(prev);
        next.delete(brandId);
        return next;
      });
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(brandId);
        return next;
      });
    }
  }

  if (joinable.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight">
          <Compass className="size-5 text-primary" aria-hidden />
          Brands you can join
        </h2>
        <p className="text-sm text-muted-foreground">
          Request access and a brand admin will add you to their portal.
        </p>
      </header>

      <div className="grid gap-grid sm:grid-cols-2">
        {joinable.map((brand) => (
          <JoinableTile
            key={brand.orgId}
            brand={brand}
            // Badge shows if the server already has a PENDING request (persists
            // across reloads) OR the caller just tapped this session (optimistic).
            requested={brand.requested || requested.has(brand.orgId)}
            pending={pending.has(brand.orgId)}
            onRequest={() => void handleRequest(brand.orgId)}
          />
        ))}
      </div>
    </div>
  );
}
