import { createFileRoute, Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PackageCheckIcon, TruckIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { OrderStatusBadge } from "@/components/order-status";
import { getMyOrder } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";
import { CARRIERS, trackingUrlFor, type CarrierKey } from "@/lib/config";

export const Route = createFileRoute("/_app/orders/$orderNumber")({
  loader: async ({ params }) => getMyOrder({ data: { orderNumber: params.orderNumber } }),
  component: OrderDetail,
});

function OrderDetail() {
  const { order, items } = Route.useLoaderData();
  const trackingUrl = trackingUrlFor(order.carrier, order.trackingNumber);
  const carrierLabel = order.carrier ? CARRIERS[order.carrier as CarrierKey]?.label : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <Link
        to="/orders"
        className="text-text-tertiary hover:text-text mb-4 inline-block font-mono text-xs"
      >
        ← all orders
      </Link>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-text text-3xl font-light tracking-tight">
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
          <h2 className="text-text font-semibold">Shipment</h2>
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
          <p className="text-text-tertiary font-mono text-sm">
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
        <div className="border-border space-y-1.5 border-t p-4 font-mono text-sm">
          <Line k="Subtotal" v={formatCents(order.subtotalCents)} />
          <Line
            k="Shipping"
            v={order.shippingCents === 0 ? "Free" : formatCents(order.shippingCents)}
          />
          <div className="border-border flex justify-between border-t pt-2 text-base">
            <span className="text-text font-semibold">Total</span>
            <span className="text-text font-semibold">{formatCents(order.totalCents)}</span>
          </div>
        </div>
      </Card>

      {/* Address */}
      <Card variant="soft" className="p-5">
        <h2 className="text-text mb-2 font-semibold">Ship to</h2>
        <address className="text-text-secondary text-sm not-italic leading-relaxed">
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
