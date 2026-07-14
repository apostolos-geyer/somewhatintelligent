import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { ExternalLinkIcon, PackageCheckIcon, TruckIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { OrderStatusBadge } from "@/components/order-status";
import { getMyOrder, updateOrderShipping } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";
import { CARRIERS, trackingUrlFor, type CarrierKey } from "@/lib/config";

export const Route = createFileRoute("/_app/orders/$orderNumber")({
  loader: async ({ params }) => getMyOrder({ data: { orderNumber: params.orderNumber } }),
  component: OrderDetail,
});

type OrderRow = Awaited<ReturnType<typeof getMyOrder>>["order"];

function OrderDetail() {
  const { order, items } = Route.useLoaderData();
  const trackingUrl = trackingUrlFor(order.carrier, order.trackingNumber);
  const carrierLabel = order.carrier ? CARRIERS[order.carrier as CarrierKey]?.label : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <Link
        to="/orders"
        className="text-muted-foreground hover:text-foreground mb-4 inline-block font-mono text-xs"
      >
        ← all orders
      </Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-foreground text-3xl font-light tracking-tight">
          {order.orderNumber}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>

      {/* Shipment / tracking */}
      <Card variant="soft" className="mb-6 p-5">
        <div className="mb-2 flex items-center gap-2">
          {order.status === "delivered" ? (
            <PackageCheckIcon className="text-verdigris size-5" />
          ) : (
            <TruckIcon className="text-primary size-5" />
          )}
          <h2 className="text-foreground font-semibold">Shipment</h2>
        </div>
        {order.status === "shipped" || order.status === "delivered" ? (
          <div className="space-y-1 font-mono text-sm">
            <Line k="Carrier" v={carrierLabel ?? order.carrier ?? "—"} />
            <Line k="Tracking #" v={order.trackingNumber ?? "—"} />
            {order.shippedAt && (
              <Line k="Shipped" v={new Date(order.shippedAt).toLocaleDateString()} />
            )}
            {order.deliveredAt && (
              <Line k="Delivered" v={new Date(order.deliveredAt).toLocaleDateString()} />
            )}
            {trackingUrl && (
              <Button
                className="mt-3"
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={trackingUrl} target="_blank" rel="noreferrer" />}
              >
                Track package <ExternalLinkIcon className="size-3.5" />
              </Button>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground font-mono text-sm">
            {order.status === "cancelled"
              ? "This order was cancelled."
              : "Not shipped yet — we'll add tracking here once it's on the way."}
          </p>
        )}
      </Card>

      {/* Items */}
      <Card className="mb-6 p-0">
        <div className="divide-border divide-y">
          {items.map((it) => (
            <div key={it.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <span className="text-muted-foreground">
                {it.titleSnapshot}{" "}
                <span className="text-muted-foreground">
                  · {it.sizeSnapshot} ×{it.quantity}
                </span>
              </span>
              <span className="text-foreground font-mono">
                {formatCents(it.unitPriceCents * it.quantity)}
              </span>
            </div>
          ))}
        </div>
        <div className="border-border space-y-1.5 border-t p-4 font-mono text-sm">
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

      <AddressSection order={order} />
    </div>
  );
}

const shippingEditSchema = type({
  name: "2 <= string <= 120",
  line1: "1 <= string <= 160",
  line2: "string <= 160",
  city: "1 <= string <= 80",
  region: "1 <= string <= 80",
  postal: "1 <= string <= 20",
  phone: "string <= 40",
});

type ShippingEditValues = typeof shippingEditSchema.infer;

// Ship-to card. The address is null before the webhook backfills it; owners may
// edit it while the order is still pending or paid.
function AddressSection({ order }: { order: OrderRow }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const canEdit = order.status === "pending" || order.status === "paid";
  const hasAddress = Boolean(order.shipName);

  const form = useAppForm({
    defaultValues: {
      name: order.shipName ?? "",
      line1: order.shipLine1 ?? "",
      line2: order.shipLine2 ?? "",
      city: order.shipCity ?? "",
      region: order.shipRegion ?? "",
      postal: order.shipPostal ?? "",
      phone: order.shipPhone ?? "",
    },
    validators: { onChange: shippingEditSchema },
    onSubmit: async ({ value }: { value: ShippingEditValues }) => {
      try {
        const res = await updateOrderShipping({
          data: {
            orderNumber: order.orderNumber,
            shipping: {
              name: value.name,
              line1: value.line1,
              ...(value.line2 ? { line2: value.line2 } : {}),
              city: value.city,
              region: value.region,
              postal: value.postal,
              ...(value.phone ? { phone: value.phone } : {}),
            },
          },
        });
        if (!res.ok) {
          toast.error(
            res.error === "not_editable"
              ? "This order can no longer be edited."
              : "Couldn't update shipping",
          );
          return;
        }
        toast.success("Shipping address updated");
        setEditing(false);
        await router.invalidate();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Couldn't update shipping");
      }
    },
  });

  return (
    <Card variant="soft" className="p-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-foreground font-semibold">Ship to</h2>
        {canEdit && !editing && (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            {hasAddress ? "Edit" : "Add address"}
          </Button>
        )}
      </div>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
          className="grid gap-4"
        >
          <form.AppField name="name">
            {(field) => <field.TextField label="Full name" autoComplete="name" />}
          </form.AppField>
          <form.AppField name="line1">
            {(field) => <field.TextField label="Address" autoComplete="address-line1" />}
          </form.AppField>
          <form.AppField name="line2">
            {(field) => (
              <field.TextField label="Apartment, suite, etc." autoComplete="address-line2" />
            )}
          </form.AppField>
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="city">
              {(field) => <field.TextField label="City" autoComplete="address-level2" />}
            </form.AppField>
            <form.AppField name="region">
              {(field) => <field.TextField label="Province" autoComplete="address-level1" />}
            </form.AppField>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="postal">
              {(field) => <field.TextField label="Postal code" autoComplete="postal-code" />}
            </form.AppField>
            <form.AppField name="phone">
              {(field) => <field.TextField label="Phone" type="tel" autoComplete="tel" />}
            </form.AppField>
          </div>
          <div className="flex gap-2">
            <form.AppForm>
              <form.SubmitButton label="Save address" loadingLabel="Saving…" size="sm" />
            </form.AppForm>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : hasAddress ? (
        <address className="text-muted-foreground text-sm not-italic leading-relaxed">
          {order.shipName}
          <br />
          {order.shipLine1}
          {order.shipLine2 ? (
            <>
              <br />
              {order.shipLine2}
            </>
          ) : null}
          <br />
          {order.shipCity}, {order.shipRegion} {order.shipPostal}
          <br />
          {order.shipCountry}
        </address>
      ) : (
        <p className="text-muted-foreground text-sm leading-relaxed">
          Shipping address pending payment confirmation.
        </p>
      )}
    </Card>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-muted-foreground flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-foreground">{v}</span>
    </div>
  );
}
