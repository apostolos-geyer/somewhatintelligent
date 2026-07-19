import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { listOrders } from "@/lib/orders.functions";
import { formatCents, formatDate } from "@/lib/format";

const FILTERS = ["all", "pending", "paid", "shipped", "delivered", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

function toFilter(value: unknown): Filter {
  return (FILTERS as readonly string[]).includes(String(value)) ? (value as Filter) : "all";
}

export const Route = createFileRoute("/orders/")({
  validateSearch: (search: Record<string, unknown>): { status: Filter; cursor?: string } => ({
    status: toFilter(search.status),
    cursor: typeof search.cursor === "string" ? search.cursor : undefined,
  }),
  loaderDeps: ({ search }) => ({ status: search.status, cursor: search.cursor }),
  loader: ({ deps }) => listOrders({ data: { status: deps.status, cursor: deps.cursor } }),
  component: OrdersList,
});

function OrdersList() {
  const result = Route.useLoaderData();
  const { status, cursor } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6">
        <h1 className="text-foreground text-3xl font-light tracking-tight">Orders</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Fulfillment and payment state across the store.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => void navigate({ to: "/orders", search: { status: f } })}
            className={
              "rounded-sm border px-3 py-1 font-mono text-xs capitalize transition-colors " +
              (status === f
                ? "border-primary text-foreground"
                : "border-border text-muted-foreground hover:text-foreground")
            }
          >
            {f}
          </button>
        ))}
      </div>

      {!result.ok ? (
        <Card variant="soft" className="p-8 text-center">
          <p className="text-destructive font-mono text-sm">This page link is no longer valid.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => void navigate({ to: "/orders", search: { status } })}
          >
            Back to first page
          </Button>
        </Card>
      ) : result.value.orders.length === 0 ? (
        <Card variant="soft" className="text-muted-foreground p-12 text-center font-mono text-sm">
          No orders in this view.
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto p-0">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface-sunken">
                  {["Order", "Email", "Ship to", "Total", "Status", "Payment", "Placed", ""].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-muted-foreground border-border border-b p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {result.value.orders.map((o, i) => (
                  <tr
                    key={o.orderNumber}
                    className={i < result.value.orders.length - 1 ? "border-border border-b" : ""}
                  >
                    <td className="text-foreground p-3 font-mono text-sm font-semibold">
                      {o.orderNumber}
                    </td>
                    <td className="text-muted-foreground p-3 text-sm">{o.email}</td>
                    <td className="text-muted-foreground p-3 text-sm">{o.shipName ?? "—"}</td>
                    <td className="text-foreground p-3 font-mono text-sm">
                      {formatCents(o.totalCents)}
                    </td>
                    <td className="p-3">
                      <OrderStatusBadge status={o.status} />
                    </td>
                    <td className="text-muted-foreground p-3 font-mono text-xs capitalize">
                      {o.paymentStatus}
                    </td>
                    <td className="text-muted-foreground p-3 font-mono text-xs">
                      {formatDate(o.createdAt)}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        to="/orders/$orderNumber"
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

          <div className="mt-4 flex items-center justify-between">
            {cursor ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void navigate({ to: "/orders", search: { status } })}
              >
                ← First page
              </Button>
            ) : (
              <span />
            )}
            {result.value.nextCursor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/orders",
                    search: { status, cursor: result.value.nextCursor ?? undefined },
                  })
                }
              >
                Next page →
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
