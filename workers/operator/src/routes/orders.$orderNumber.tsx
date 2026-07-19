import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { type } from "arktype";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { Alert, AlertDescription, AlertTitle } from "@si/ui/components/alert";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { fulfillOrder, getOrder, markDelivered, setOrderStatus } from "@/lib/orders.functions";
import { formatCents } from "@/lib/format";
import { CARRIER_KEYS, CARRIER_OPTIONS, carrierLabel, trackingUrlFor } from "@/lib/carriers";
import type { DomainResult, OrderDetailDTO, OrderMutationError } from "@si/contracts";

const ERROR_COPY: Record<OrderMutationError, string> = {
  not_found: "This order no longer exists.",
  invalid_transition: "That change isn't allowed from the order's current state.",
  payment_incomplete: "Payment hasn't completed yet, so this action can't run.",
  already_fulfilled: "This order was already fulfilled and can no longer be changed.",
};

const shipSchema = type({
  carrier: type.enumerated(...CARRIER_KEYS),
  tracking: "1 <= string <= 80",
  note: "string <= 500",
});

export const Route = createFileRoute("/orders/$orderNumber")({
  loader: ({ params }) => getOrder({ data: { orderNumber: params.orderNumber } }),
  component: OrderDetail,
});

function OrderDetail() {
  const result = Route.useLoaderData();

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-3xl">
        <BackLink />
        <Card variant="soft" className="mt-4 p-10 text-center">
          <p className="text-foreground font-mono text-sm">Order not found.</p>
          <p className="text-muted-foreground mt-1 text-xs">
            It may have been removed, or the order number is wrong.
          </p>
        </Card>
      </div>
    );
  }

  return <OrderView order={result.value} />;
}

function OrderView({ order }: { order: OrderDetailDTO }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OrderMutationError | null>(null);

  async function run(
    action: () => Promise<DomainResult<OrderDetailDTO, OrderMutationError>>,
  ): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  }

  const shipForm = useAppForm({
    defaultValues: { carrier: "canadapost", tracking: "", note: "" },
    validators: { onChange: shipSchema },
    onSubmit: async ({ value }) => {
      setError(null);
      const res = await fulfillOrder({
        data: {
          commandId: crypto.randomUUID(),
          orderNumber: order.orderNumber,
          carrier: value.carrier,
          trackingNumber: value.tracking.trim(),
          note: value.note.trim() || undefined,
        },
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      await router.invalidate();
    },
  });

  const canCancel = order.status === "pending" || order.status === "paid";
  const trackingUrl = trackingUrlFor(order.carrier, order.trackingNumber);

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink />
      <div className="mb-6 mt-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground font-mono text-2xl font-semibold tracking-tight">
            {order.orderNumber}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {order.email} · payment <span className="capitalize">{order.paymentStatus}</span>
          </p>
        </div>
        <OrderStatusBadge status={order.status} />
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertTitle>Couldn't complete that action</AlertTitle>
          <AlertDescription>{ERROR_COPY[error]}</AlertDescription>
        </Alert>
      )}

      <Card variant="soft" className="mb-6 p-5">
        <h2 className="text-foreground mb-3 font-semibold">Fulfillment</h2>

        {order.status === "pending" && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  setOrderStatus({
                    data: {
                      commandId: crypto.randomUUID(),
                      orderNumber: order.orderNumber,
                      status: "paid",
                    },
                  }),
                )
              }
            >
              Mark as paid
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !canCancel}
              onClick={() =>
                void run(() =>
                  setOrderStatus({
                    data: {
                      commandId: crypto.randomUUID(),
                      orderNumber: order.orderNumber,
                      status: "cancelled",
                    },
                  }),
                )
              }
            >
              Cancel order
            </Button>
          </div>
        )}

        {order.status === "paid" && (
          <div className="grid gap-4">
            <p className="text-muted-foreground font-mono text-xs">
              Attach a carrier and tracking number to mark this order shipped.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void shipForm.handleSubmit();
              }}
              className="grid gap-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <shipForm.AppField name="carrier">
                  {(field) => <field.SelectField label="Carrier" options={CARRIER_OPTIONS} />}
                </shipForm.AppField>
                <shipForm.AppField name="tracking">
                  {(field) => <field.TextField label="Tracking number" placeholder="1Z…" />}
                </shipForm.AppField>
              </div>
              <shipForm.AppField name="note">
                {(field) => <field.TextareaField label="Note (optional)" rows={2} />}
              </shipForm.AppField>
              <div className="flex flex-wrap gap-2">
                <shipForm.AppForm>
                  <shipForm.SubmitButton label="Mark shipped & attach tracking" />
                </shipForm.AppForm>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      setOrderStatus({
                        data: {
                          commandId: crypto.randomUUID(),
                          orderNumber: order.orderNumber,
                          status: "cancelled",
                        },
                      }),
                    )
                  }
                >
                  Cancel order
                </Button>
              </div>
            </form>
          </div>
        )}

        {order.status === "shipped" && (
          <div className="grid gap-3">
            <dl className="grid gap-1.5 font-mono text-sm">
              <Line k="Carrier" v={carrierLabel(order.carrier) ?? "—"} />
              <Line
                k="Tracking #"
                v={
                  trackingUrl ? (
                    <a
                      href={trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {order.trackingNumber}
                    </a>
                  ) : (
                    (order.trackingNumber ?? "—")
                  )
                }
              />
              {order.fulfillmentNote && <Line k="Note" v={order.fulfillmentNote} />}
            </dl>
            <Button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  markDelivered({
                    data: { commandId: crypto.randomUUID(), orderNumber: order.orderNumber },
                  }),
                )
              }
            >
              Mark delivered
            </Button>
          </div>
        )}

        {(order.status === "delivered" || order.status === "cancelled") && (
          <p className="text-muted-foreground font-mono text-sm">
            {order.status === "delivered"
              ? "Delivered — nothing left to do."
              : "This order was cancelled."}
          </p>
        )}
      </Card>

      <Card className="mb-6 p-0">
        <div className="divide-border divide-y">
          {order.items.map((it) => (
            <div key={it.variantId} className="flex justify-between gap-3 p-3 text-sm">
              <span className="text-muted-foreground">
                {it.title}
                <span className="text-muted-foreground/80">
                  {" · "}
                  {it.size} ×{it.quantity}
                </span>
              </span>
              <span className="text-foreground font-mono">
                {formatCents(it.unitPriceCents * it.quantity)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-border space-y-1.5 border-t p-3 font-mono text-sm">
          <Line k="Subtotal" v={formatCents(order.subtotalCents)} />
          <Line
            k="Shipping"
            v={order.shippingCents === 0 ? "Free" : formatCents(order.shippingCents)}
          />
          <div className="border-border flex justify-between border-t pt-2 text-base">
            <span className="text-foreground font-semibold">Total</span>
            <span className="text-foreground font-semibold">{formatCents(order.totalCents)}</span>
          </div>
        </div>
      </Card>

      <Card variant="soft" className="p-5">
        <h2 className="text-foreground mb-2 font-semibold">Ship to</h2>
        {order.shipping ? (
          <address className="text-muted-foreground text-sm not-italic leading-relaxed">
            {order.shipping.name}
            <br />
            {order.email}
            {order.shipping.phone ? ` · ${order.shipping.phone}` : ""}
            <br />
            {order.shipping.line1}
            {order.shipping.line2 ? `, ${order.shipping.line2}` : ""}
            <br />
            {order.shipping.city}, {order.shipping.region} {order.shipping.postal} ·{" "}
            {order.shipping.country}
          </address>
        ) : (
          <p className="text-muted-foreground font-mono text-sm">No shipping address on file.</p>
        )}
      </Card>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/orders"
      search={{ status: "all" }}
      className="text-muted-foreground hover:text-foreground inline-block font-mono text-xs"
    >
      ← all orders
    </Link>
  );
}

function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}
