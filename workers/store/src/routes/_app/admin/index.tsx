import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@si/ui/components/card";
import { Button } from "@si/ui/components/button";
import { adminStats } from "@/lib/orders.functions";
import { formatCents } from "@/lib/money";

export const Route = createFileRoute("/_app/admin/")({
  loader: async () => adminStats(),
  component: Dashboard,
});

function Dashboard() {
  const s = Route.useLoaderData();
  const stats = [
    {
      k: "revenue",
      v: formatCents(s.revenueCents),
      d: "paid + shipped + delivered",
      tone: "text-verdigris",
    },
    {
      k: "orders",
      v: String(s.totalOrders),
      d: `${s.awaitingPayment} awaiting payment`,
      tone: "text-foreground",
    },
    {
      k: "to ship",
      v: String(s.toShip),
      d: s.toShip > 0 ? "needs tracking" : "all caught up",
      tone: s.toShip > 0 ? "text-ochre" : "text-slate",
    },
    {
      k: "live styles",
      v: String(s.activeProducts),
      d: `${s.totalProducts} total`,
      tone: "text-foreground",
    },
  ];

  return (
    <div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map((st) => (
          <Card key={st.k} variant="soft" className="gap-2 p-4">
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              {st.k}
            </span>
            <div className="font-display text-foreground text-3xl font-light tracking-tighter">
              {st.v}
            </div>
            <div className={`font-mono text-xs ${st.tone}`}>{st.d}</div>
          </Card>
        ))}
      </div>

      <div className="mt-8 flex gap-3">
        <Button nativeButton={false} render={<Link to="/admin/products" />}>
          Manage catalog
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/admin/orders" search={{ status: "all" }} />}
        >
          Manage orders
        </Button>
      </div>
    </div>
  );
}
