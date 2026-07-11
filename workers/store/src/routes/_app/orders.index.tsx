import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { OrderStatusBadge } from "@/components/order-status";
import { listMyOrders } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";

export const Route = createFileRoute("/_app/orders/")({
  loader: async () => listMyOrders(),
  component: MyOrders,
});

function MyOrders() {
  const { orders } = Route.useLoaderData();
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-foreground mb-6 text-3xl font-light tracking-tight">
        My orders
      </h1>

      {orders.length === 0 ? (
        <Card variant="soft" className="text-muted-foreground p-12 text-center font-mono text-sm">
          No orders yet.
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link
              key={o.id}
              to="/orders/$orderNumber"
              params={{ orderNumber: o.orderNumber }}
              className="block"
            >
              <Card className="hover:border-foreground flex flex-row items-center justify-between gap-4 p-4 transition-colors">
                <div>
                  <div className="text-foreground font-mono text-sm font-semibold">
                    {o.orderNumber}
                  </div>
                  <div className="text-muted-foreground font-mono text-xs">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <OrderStatusBadge status={o.status} />
                  <span className="text-foreground font-mono text-sm">
                    {formatCents(o.totalCents)}
                  </span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
