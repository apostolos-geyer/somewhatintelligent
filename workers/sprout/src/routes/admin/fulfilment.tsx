import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type } from "arktype";
import { CheckCircle2, Package, Truck, XCircle } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@greenroom/ui/components/dialog";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  decideFulfilment,
  listFulfilmentQueue,
  REQUEST_STATUSES,
  type FulfilmentRequestView,
  type RequestStatus,
} from "@/lib/requests.functions";

/**
 * Brand-Admin fulfilment queue (P4.A). Nests under the pathless `admin.tsx`
 * guard — SELF-CONTAINED (imports no Admin setup chrome). The reads + the decision
 * mutation are brand-role gated server-side (`decideBrandAdmin`); brand_id is the
 * envelope's activeOrgId, never sent.
 *
 * The operator filters by status and advances each request: Approve (Requested →
 * Approved), Ship (→ Shipped, with optional tracking), or Decline (→ Declined,
 * with an optional reason). Every transition notifies the requester in-platform
 * (`fulfilment_status`) — handled server-side; this surface just dispatches the
 * decision and refreshes.
 */
export const Route = createFileRoute("/admin/fulfilment")({
  component: AdminFulfilmentPage,
});

const STATUS_BADGE: Record<RequestStatus, "warn" | "info" | "sprout" | "outline" | "lime"> = {
  Requested: "warn",
  Approved: "info",
  Shipped: "sprout",
  Deployed: "lime",
  Declined: "outline",
};

const FILTERS: ReadonlyArray<{ value: RequestStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  ...REQUEST_STATUSES.map((s) => ({ value: s, label: s })),
];

function AdminFulfilmentPage() {
  const [requests, setRequests] = useState<FulfilmentRequestView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<RequestStatus | "all">("Requested");
  const [deciding, setDeciding] = useState<{
    request: FulfilmentRequestView;
    action: "Approved" | "Shipped" | "Declined";
  } | null>(null);

  async function refresh() {
    try {
      setRequests(await listFulfilmentQueue({ data: filter === "all" ? {} : { status: filter } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the queue.");
      setRequests([]);
    }
  }

  useEffect(() => {
    setRequests(null);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Fulfilment</h1>
        <p className="text-sm text-muted-foreground">
          Physical-print requests from budtenders. Approve, ship, or decline — the requester is
          notified in-platform on every decision.
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            type="button"
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {error && (
        <p className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {requests === null && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-sm" />
          ))}
        </div>
      )}

      {requests !== null && requests.length === 0 && (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
          <Package className="size-10 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No {filter === "all" ? "" : `${filter.toLowerCase()} `}requests right now.
          </p>
        </div>
      )}

      <ul className="space-y-3">
        {requests?.map((request) => (
          <li key={request.id}>
            <div className={cn("flex flex-col gap-3 p-4", surfaceMaterials.brutal)}>
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
                <Badge variant={STATUS_BADGE[request.status]}>{request.status}</Badge>
              </div>

              <dl className="grid gap-x-6 gap-y-1 pl-8 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Ship to</dt>
                  <dd>
                    {request.shipStreet}, {request.shipCity}, {request.shipProvince}{" "}
                    {request.shipPostal}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">Contact</dt>
                  <dd>
                    {request.contactName} · {request.contactPhone}
                  </dd>
                </div>
                {request.note && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">Note</dt>
                    <dd>{request.note}</dd>
                  </div>
                )}
                {request.status === "Shipped" && request.tracking && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Tracking
                    </dt>
                    <dd>{request.tracking}</dd>
                  </div>
                )}
                {request.status === "Declined" && request.declineReason && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Decline reason
                    </dt>
                    <dd>{request.declineReason}</dd>
                  </div>
                )}
                {/* Proof-of-display — the budtender confirmed the display is up. */}
                {request.status === "Deployed" && (
                  <div className="sm:col-span-2">
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Display confirmed up
                      {request.deployedAt
                        ? ` · ${new Date(request.deployedAt).toLocaleDateString()}`
                        : ""}
                    </dt>
                    <dd>
                      {request.proofPhotoUrl ? (
                        <a href={request.proofPhotoUrl} target="_blank" rel="noreferrer">
                          <img
                            src={request.proofPhotoUrl}
                            alt={`In-store proof for ${request.assetName}`}
                            className="mt-1 max-h-48 w-auto rounded-sm border border-border object-contain"
                          />
                        </a>
                      ) : (
                        <span className="text-muted-foreground">
                          Confirmed by the budtender
                          {request.proofPhotoRef ? " (photo processing)" : " (no photo)"}.
                        </span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              {/* Allowed transitions: Requested → Approve/Decline; Approved → Ship/Decline.
                  Shipped + Declined are terminal. */}
              {(request.status === "Requested" || request.status === "Approved") && (
                <div className="flex flex-wrap gap-2 pl-8">
                  {request.status === "Requested" && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => setDeciding({ request, action: "Approved" })}
                    >
                      <CheckCircle2 className="size-4" aria-hidden />
                      Approve
                    </Button>
                  )}
                  {request.status === "Approved" && (
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={() => setDeciding({ request, action: "Shipped" })}
                    >
                      <Truck className="size-4" aria-hidden />
                      Mark shipped
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDeciding({ request, action: "Declined" })}
                  >
                    <XCircle className="size-4" aria-hidden />
                    Decline
                  </Button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {deciding && (
        <DecisionDialog
          request={deciding.request}
          action={deciding.action}
          onClose={() => setDeciding(null)}
          onDecided={() => {
            setDeciding(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── decision (approve / ship / decline) ────────────────────────────────────

const decisionSchema = type({
  tracking: "string",
  reason: "string",
});

const ACTION_COPY: Record<
  "Approved" | "Shipped" | "Declined",
  { title: string; description: string; submit: string }
> = {
  Approved: {
    title: "Approve request",
    description: "The requester is notified that their print is approved and being prepared.",
    submit: "Approve",
  },
  Shipped: {
    title: "Mark as shipped",
    description: "Add a tracking number if you have one — it shows on the requester's status.",
    submit: "Mark shipped",
  },
  Declined: {
    title: "Decline request",
    description: "Add an optional reason — it shows on the requester's status.",
    submit: "Decline",
  },
};

function DecisionDialog({
  request,
  action,
  onClose,
  onDecided,
}: {
  request: FulfilmentRequestView;
  action: "Approved" | "Shipped" | "Declined";
  onClose: () => void;
  onDecided: () => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const copy = ACTION_COPY[action];

  const form = useAppForm({
    defaultValues: { tracking: "", reason: "" },
    validators: { onBlur: decisionSchema },
    onSubmit: async ({ value }) => {
      setSaveError(null);
      try {
        await decideFulfilment({
          data: {
            requestId: request.id,
            status: action,
            ...(action === "Shipped" && value.tracking.trim()
              ? { tracking: value.tracking.trim() }
              : {}),
            ...(action === "Declined" && value.reason.trim()
              ? { reason: value.reason.trim() }
              : {}),
          },
        });
        onDecided();
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : "Decision failed.");
      }
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton>
        <DialogHeader>
          <DialogTitle>
            {copy.title} — {request.assetName}
          </DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {action === "Shipped" && (
            <form.AppField name="tracking">
              {(field) => <field.TextField label="Tracking number" placeholder="Optional" />}
            </form.AppField>
          )}
          {action === "Declined" && (
            <form.AppField name="reason">
              {(field) => (
                <field.TextareaField
                  label="Reason"
                  rows={2}
                  placeholder="Out of stock, address invalid… Optional."
                />
              )}
            </form.AppField>
          )}

          {saveError && <p className="text-sm text-destructive">{saveError}</p>}

          <div className="flex justify-end gap-2">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <form.AppForm>
              <form.SubmitButton label={copy.submit} />
            </form.AppForm>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
