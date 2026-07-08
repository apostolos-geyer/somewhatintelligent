import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { OrderStatusBadge } from "@/components/order-status";
import { fulfillOrder, getOrderAdmin, markDelivered, setOrderStatus } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";
import { CARRIERS, CARRIER_KEYS, type CarrierKey } from "@/lib/config";

const CARRIER_OPTIONS = Object.entries(CARRIERS).map(([value, v]) => ({ value, label: v.label }));

const shipSchema = type({
  carrier: type.enumerated(...CARRIER_KEYS),
  tracking: "1 <= string <= 80",
  note: "string <= 500",
});

export const Route = createFileRoute("/_app/admin/orders/$orderNumber")({
  loader: async ({ params }) => getOrderAdmin({ data: { orderNumber: params.orderNumber } }),
  component: ManageOrder,
});

function ManageOrder() {
  const { order, items } = Route.useLoaderData();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const shipForm = useAppForm({
    defaultValues: { carrier: "canadapost", tracking: "", note: "" },
    validators: { onChange: shipSchema },
    onSubmit: async ({ value }) => {
      const res = await fulfillOrder({
        data: {
          orderNumber: order.orderNumber,
          carrier: value.carrier as CarrierKey,
          trackingNumber: value.tracking.trim(),
          note: value.note.trim() || undefined,
        },
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Order marked shipped & tracking attached");
      await router.invalidate();
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        to="/admin/orders"
        search={{ status: "all" }}
        className="text-text-tertiary hover:text-text mb-4 inline-block font-mono text-xs"
      >
        ← all orders
      </Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h2 className="font-display text-text text-2xl font-light tracking-tight">
          {order.orderNumber}
        </h2>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Fulfillment actions */}
      <Card variant="soft" className="mb-6 p-5">
        <h3 className="text-text mb-3 font-semibold">Fulfillment</h3>

        {order.status === "pending" && (
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    setOrderStatus({ data: { orderNumber: order.orderNumber, status: "paid" } }),
                  "Marked as paid",
                )
              }
            >
              Mark as paid
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    setOrderStatus({
                      data: { orderNumber: order.orderNumber, status: "cancelled" },
                    }),
                  "Order cancelled",
                )
              }
            >
              Cancel order
            </Button>
          </div>
        )}

        {order.status === "paid" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void shipForm.handleSubmit();
            }}
            className="grid gap-4"
          >
            <p className="text-text-tertiary font-mono text-xs">
              Attach a carrier + tracking number to ship. The customer sees the tracking link on
              their order page.
            </p>
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
            <shipForm.AppForm>
              <shipForm.SubmitButton label="Mark shipped & attach tracking" />
            </shipForm.AppForm>
          </form>
        )}

        {order.status === "shipped" && (
          <div className="grid gap-3">
            <div className="font-mono text-sm">
              <Line
                k="Carrier"
                v={CARRIERS[order.carrier as CarrierKey]?.label ?? order.carrier ?? "—"}
              />
              <Line k="Tracking #" v={order.trackingNumber ?? "—"} />
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                void run(
                  () => markDelivered({ data: { orderNumber: order.orderNumber } }),
                  "Marked delivered",
                )
              }
            >
              Mark delivered
            </Button>
          </div>
        )}

        {(order.status === "delivered" || order.status === "cancelled") && (
          <p className="text-text-tertiary font-mono text-sm">
            {order.status === "delivered"
              ? "Delivered — nothing left to do."
              : "This order was cancelled."}
          </p>
        )}
      </Card>

      {/* Items */}
      <Card className="mb-6 p-0">
        <div className="divide-border divide-y-2 divide-dashed">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between gap-3 p-3 text-sm">
              <span className="text-text-secondary">
                {it.titleSnapshot}{" "}
                <span className="text-text-tertiary">
                  · {it.sizeSnapshot} ×{it.quantity}
                </span>
              </span>
              <span className="text-text font-mono">
                {formatCents(it.unitPriceCents * it.quantity)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-border space-y-1.5 border-t-2 border-dashed p-3 font-mono text-sm">
          <Line k="Subtotal" v={formatCents(order.subtotalCents)} />
          <Line
            k="Shipping"
            v={order.shippingCents === 0 ? "Free" : formatCents(order.shippingCents)}
          />
          <div className="border-border flex justify-between border-t-2 border-dashed pt-2 text-base">
            <span className="text-text font-semibold">Total</span>
            <span className="text-text font-semibold">{formatCents(order.totalCents)}</span>
          </div>
        </div>
      </Card>

      {/* Customer */}
      <Card variant="soft" className="p-5">
        <h3 className="text-text mb-2 font-semibold">Ship to</h3>
        <address className="text-text-secondary text-sm not-italic leading-relaxed">
          {order.shipName}
          <br />
          {order.email}
          {order.shipPhone ? ` · ${order.shipPhone}` : ""}
          <br />
          {order.shipLine1}
          {order.shipLine2 ? `, ${order.shipLine2}` : ""}
          <br />
          {order.shipCity}, {order.shipRegion} {order.shipPostal} · {order.shipCountry}
        </address>
      </Card>
    </div>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-text-secondary flex justify-between gap-3">
      <span className="text-text-tertiary">{k}</span>
      <span className="text-text">{v}</span>
    </div>
  );
}
