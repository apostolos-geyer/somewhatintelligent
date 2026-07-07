import { createFileRoute, Link, Outlet, redirect, useLocation } from "@tanstack/react-router";
import { BoxIcon, LayoutDashboardIcon, ShirtIcon } from "lucide-react";

// Admin shell. _app already guarantees a session; here we additionally require
// the `admin` role (RFC-011: anon < user < trusted < admin). Server functions
// are independently gated by requireAdminMiddleware — this is the UI gate.
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (context.session?.user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

const TABS = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboardIcon, exact: true },
  { to: "/admin/products", label: "Catalog", icon: ShirtIcon, exact: false },
  { to: "/admin/orders", label: "Orders", icon: BoxIcon, exact: false },
] as const;

function AdminLayout() {
  const pathname = useLocation({ select: (s) => s.pathname });
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="font-display text-text text-3xl font-light tracking-tight">Admin</h1>
        <span className="text-text-tertiary font-mono text-xs">catalog · fulfillment</span>
      </div>
      <nav className="border-border mb-8 flex gap-1 border-b">
        {TABS.map((t) => {
          const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors " +
                (active
                  ? "border-primary text-text"
                  : "text-text-tertiary hover:text-text border-transparent")
              }
            >
              <Icon className="size-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
      <Outlet />
    </div>
  );
}
