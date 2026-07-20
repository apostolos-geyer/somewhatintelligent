import { useEffect } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { toast } from "@si/ui/components/sonner";
import { PageHeader } from "@/components/page-header";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { listOrders } from "@/lib/orders.functions";
import { formatCents, formatDate } from "@/lib/format";

const FILTERS = ["all", "pending", "paid", "shipped", "delivered", "cancelled"] as const;
type Filter = (typeof FILTERS)[number];

function toFilter(value: unknown): Filter {
  return (FILTERS as readonly string[]).includes(String(value)) ? (value as Filter) : "all";
}

const COLUMNS = ["Order", "Email", "Ship to", "Total", "Status", "Payment", "Placed", ""] as const;

export const Route = createFileRoute("/orders/")({
  // The Overview dashboard deep-links here with `?status=pending`; validateSearch
  // is the single source the filter chips initialize from (Route.useSearch).
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

  // A stale/invalid cursor link surfaces as a toast, not an inline error block;
  // the body falls back to a recovery card.
  useEffect(() => {
    if (!result.ok) toast.error("This page link is no longer valid.");
  }, [result.ok]);

  const orders = result.ok ? result.value.orders : [];
  const nextCursor = result.ok ? result.value.nextCursor : null;

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <PageHeader title="Orders" subtitle="Fulfillment and payment state across the store." />

      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
        <Card
          variant="soft"
          className="flex flex-col items-center justify-center gap-4 p-12 text-center lg:min-h-0 lg:flex-1"
        >
          <p className="text-muted-foreground font-mono text-sm">This view could not be loaded.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void navigate({ to: "/orders", search: { status } })}
          >
            Back to first page
          </Button>
        </Card>
      ) : orders.length === 0 ? (
        <Card
          variant="soft"
          className="text-muted-foreground flex items-center justify-center p-12 text-center font-mono text-sm lg:min-h-0 lg:flex-1"
        >
          No orders in this view.
        </Card>
      ) : (
        // Full-width panel: fixed header, table scrolls inside the card (sticky
        // thead), pagination pinned below the scroll region — no page scroll.
        <Card className="flex flex-col gap-0 overflow-hidden p-0 lg:min-h-0 lg:flex-1">
          <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
            <h2 className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              {status === "all" ? "All orders" : status}
            </h2>
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              {orders.length}
              {nextCursor ? "+" : ""}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {COLUMNS.map((h) => (
                    <th
                      key={h}
                      className="text-muted-foreground border-border bg-surface-sunken sticky top-0 z-10 border-b p-3 text-left font-mono text-[10px] font-semibold uppercase tracking-wider"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr
                    key={o.orderNumber}
                    className={i < orders.length - 1 ? "border-border border-b" : ""}
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
          </div>

          <div className="border-border flex shrink-0 items-center justify-between border-t px-5 py-3">
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
            {nextCursor ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/orders",
                    search: { status, cursor: nextCursor ?? undefined },
                  })
                }
              >
                Next page →
              </Button>
            ) : (
              <span />
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
