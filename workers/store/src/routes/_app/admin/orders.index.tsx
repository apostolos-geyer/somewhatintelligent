import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { OrderStatusBadge } from "@/components/order-status";
import { listAllOrders } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";
import { ORDER_STATUSES } from "@/lib/config";

const FILTERS = ["all", ...ORDER_STATUSES] as const;

export const Route = createFileRoute("/_app/admin/orders/")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: (FILTERS as readonly string[]).includes(String(search.status))
      ? (search.status as string)
      : "all",
  }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => listAllOrders({ data: { status: deps.status } }),
  component: AdminOrders,
});

function AdminOrders() {
  const { orders } = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h2 className="text-text mr-2 text-xl font-semibold">Orders</h2>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => void navigate({ to: "/admin/orders", search: { status: f } })}
            className={
              "rounded-sm border px-3 py-1 font-mono text-xs capitalize transition-colors " +
              (status === f
                ? "border-primary text-text"
                : "border-border text-text-tertiary hover:text-text")
            }
          >
            {f}
          </button>
        ))}
      </div>

      {orders.length === 0 ? (
        <Card variant="soft" className="text-text-tertiary p-12 text-center font-mono text-sm">
          No orders in this view.
        </Card>
      ) : (
        <Card className="p-0">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-surface-sunken">
                {["Order", "Customer", "Total", "Status", "Placed", ""].map((h) => (
                  <th
                    key={h}
                    className="text-text-tertiary border-foreground border-b-2 p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orders.map((o, i) => (
                <tr key={o.id} className={i < orders.length - 1 ? "border-border border-b" : ""}>
                  <td className="text-text p-3 font-mono text-sm font-semibold">{o.orderNumber}</td>
                  <td className="text-text-secondary p-3 text-sm">{o.shipName}</td>
                  <td className="text-text p-3 font-mono text-sm">{formatCents(o.totalCents)}</td>
                  <td className="p-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="text-text-tertiary p-3 font-mono text-xs">
                    {new Date(o.createdAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right">
                    <Link
                      to="/admin/orders/$orderNumber"
                      params={{ orderNumber: o.orderNumber }}
                      className="text-primary font-mono text-xs underline-offset-4 hover:underline"
                    >
                      manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
