import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { isAdminRole } from "@si/kit/roles";
import { getStats } from "@/lib/admin.functions";
import { GridLine } from "@si/ui/components/grid-line";

export const Route = createFileRoute("/_dashboard/admin")({
  // Full-load / SSR gate. On the client `context.session` is the root
  // `beforeLoad` result, which does NOT re-run on SPA navigation — so it can
  // be a stale or not-yet-hydrated value. Only hard-bounce when we have a
  // *definitive* session that isn't an admin; the unknown case is resolved in
  // the component against the live client session. (Same shape as
  // `_dashboard`'s sign-in guard, which exists to avoid this exact transient-
  // session bounce.)
  beforeLoad: ({ context }) => {
    if (context.session && !isAdminRole(context.session.user.role)) {
      throw redirect({ href: "/account" });
    }
  },
  loader: () => getStats(),
  head: () => ({ meta: [{ title: "Admin — Identity" }] }),
  component: AdminGate,
});

// The stat grid renders unconditionally as the persistent background for
// every /admin/* route; sub-pages match into the `Outlet` below and render
// themselves inside a Sheet.
function AdminGate() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const data = Route.useLoaderData();

  const session = liveSession ?? ssrSession;
  const isAdmin = isAdminRole(session?.user.role);

  // Bounce non-admins only once the live session has settled. Never redirect
  // while the session is still unknown (live query pending and no SSR session)
  // — that's the hydration window that was sending admins to /account.
  useEffect(() => {
    if (!isPending && session && !isAdmin) {
      void navigate({ href: "/account", replace: true });
    }
  }, [isPending, session, isAdmin, navigate]);

  // Render the admin section only once we positively know the viewer is an
  // admin — avoids both the false bounce and flashing admin UI to non-admins.
  if (!isAdmin) return null;

  const stats = [
    { label: "Users", value: data.users },
    { label: "Sessions", value: data.sessions, note: "active" },
    { label: "Clients", value: data.clients, note: "registered" },
  ];

  return (
    <div className="relative flex flex-1 flex-col gap-grid">
      <GridLine orientation="vertical" className="left-0" />
      <GridLine orientation="vertical" className="right-0" />

      <p className="text-sm text-text-secondary">The state of things, such as it is.</p>

      <GridLine />

      <div className="grid grid-cols-3 gap-grid">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-sm border-2 border-dashed border-border bg-surface-sunken px-4 py-3"
          >
            <div className="type-mono-label text-text-tertiary">{stat.label}</div>
            <div className="type-stat mt-1">{stat.value.toLocaleString()}</div>
            {stat.note && <div className="mt-2 text-xs text-text-tertiary">{stat.note}</div>}
          </div>
        ))}
      </div>

      <GridLine />

      <Outlet />
    </div>
  );
}
