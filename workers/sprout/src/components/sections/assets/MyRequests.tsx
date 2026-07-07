import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, Package, Truck, Upload } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Card } from "@greenroom/ui/components/card";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  confirmDeployed,
  listMyRequests,
  registerDisplayProof,
  type MyRequestView,
  type RequestStatus,
} from "@/lib/requests.functions";
import { sha256Hex } from "@/lib/files";

/**
 * "My Requests" sub-view of the Store-Assets layer (Surface 6) — the caller's own
 * physical-print requests, scoped server-side to the caller + active brand by
 * `listMyRequests`. This is the SAME status view as the deep-linkable `/requests`
 * route, surfaced inline as a tab of the assets layer so the budtender can flip
 * between the library and the status of what they've ordered without leaving the
 * section. It owns its own fetch (a passive read in `useEffect`); the shell owns
 * the standalone route. Each row shows the asset, quantity, store, status badge,
 * and — once the brand has decided — the tracking (Shipped) or reason (Declined).
 *
 * The status badge uses the Sprout tone scale: Requested→warn (amber/Pistil),
 * Approved→info (Purple Haze), Shipped→sprout (the brand green), Declined→danger.
 * Status is conveyed by the badge's TEXT, never colour alone (§04 a11y).
 */
const STATUS_BADGE: Record<
  RequestStatus,
  { variant: "warn" | "info" | "sprout" | "danger" | "lime"; label: string }
> = {
  Requested: { variant: "warn", label: "Requested" },
  Approved: { variant: "info", label: "Approved" },
  Shipped: { variant: "sprout", label: "Shipped" },
  Deployed: { variant: "lime", label: "Deployed" },
  Declined: { variant: "danger", label: "Declined" },
};

export function MyRequests() {
  const [requests, setRequests] = useState<MyRequestView[] | null>(null);

  async function refresh() {
    try {
      setRequests(await listMyRequests());
    } catch {
      setRequests([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listMyRequests();
        if (!cancelled) setRequests(rows);
      } catch {
        if (!cancelled) setRequests([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (requests === null) {
    return (
      <div className="space-y-3" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-md" />
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (requests.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <Package className="size-10 text-muted-foreground" aria-hidden />
        <h3 className="font-display text-lg font-bold">No requests yet</h3>
        <p className="text-sm text-muted-foreground">You haven&apos;t requested anything yet.</p>
      </div>
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────
  return (
    <ul className="space-y-3">
      {requests.map((request) => {
        const badge = STATUS_BADGE[request.status];
        return (
          <li key={request.id}>
            <Card className={cn("flex flex-col gap-2 p-4", surfaceMaterials.brutal)}>
              <div className="flex items-start gap-3">
                <Package className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium" title={request.assetName}>
                    {request.assetName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Qty {request.quantity} · {request.store} · Requested{" "}
                    <time dateTime={new Date(request.createdAt).toISOString()}>
                      {new Date(request.createdAt).toLocaleDateString()}
                    </time>
                  </p>
                </div>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </div>

              {request.status === "Shipped" && request.tracking && (
                <p className="flex items-center gap-1.5 pl-8 text-sm text-muted-foreground">
                  <Truck className="size-4 shrink-0" aria-hidden />
                  Tracking: <span className="font-medium text-foreground">{request.tracking}</span>
                </p>
              )}
              {request.status === "Declined" && request.declineReason && (
                <p className="pl-8 text-sm text-muted-foreground">
                  Reason: <span className="text-foreground">{request.declineReason}</span>
                </p>
              )}

              {/* Proof-of-display: confirm the display went up once it's shipped. */}
              {request.status === "Shipped" && (
                <ProofConfirm requestId={request.id} onDone={() => void refresh()} />
              )}
              {request.status === "Deployed" && (
                <p className="flex items-center gap-1.5 pl-8 text-sm text-success">
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden />
                  You confirmed this display is up
                  {request.proofPhotoRef ? " — photo on file." : "."}
                </p>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The budtender's "confirm the display is up" control on a Shipped request. Lets
 * them optionally attach an in-store photo (roadie upload — degrades to a
 * photo-less confirmation when R2 is inert), then flips the request to Deployed
 * via `confirmDeployed`. This is the proof the LP sees on their fulfilment queue.
 */
function ProofConfirm({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      let referenceId: string | undefined;
      if (file) {
        if (!file.type.startsWith("image/")) throw new Error("Please choose an image.");
        const hash = await sha256Hex(file);
        const reg = await registerDisplayProof({
          data: { requestId, hash, size: file.size, contentType: file.type || "image/jpeg" },
        });
        // Only thread the ref through if the bytes actually pushed (roadie live).
        if (reg.upload) {
          const put = await fetch(reg.upload.url, {
            method: "PUT",
            headers: reg.upload.headers,
            body: file,
          });
          if (put.ok) referenceId = reg.referenceId;
        }
      }
      await confirmDeployed({ data: referenceId ? { requestId, referenceId } : { requestId } });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't confirm. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ml-8 flex flex-col gap-2 rounded-sm border border-dashed border-border p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Camera className="size-4 text-primary" aria-hidden />
        Got it up in store? Let the brand know.
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="text-xs file:mr-2 file:rounded-sm file:border file:border-border file:bg-card file:px-2 file:py-1"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="strong"
          disabled={busy}
          onClick={() => void confirm()}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {file ? "Upload + confirm display" : "Confirm display is up"}
        </Button>
        {file && <span className="truncate text-xs text-muted-foreground">{file.name}</span>}
      </div>
    </div>
  );
}
