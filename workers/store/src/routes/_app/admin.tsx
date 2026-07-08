import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// Admin shell. _app already guarantees a session; here we additionally require
// the `admin` role (RFC-011: anon < user < trusted < admin). Server functions
// are independently gated by requireAdminMiddleware — this is the UI gate.
// Navigation lives in the shared FAB (`components/store-frame.tsx`), not a
// tab bar here.
export const Route = createFileRoute("/_app/admin")({
  beforeLoad: ({ context }) => {
    if (context.session?.user.role !== "admin") {
      throw redirect({ to: "/" });
    }
  },
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-6">
      <Outlet />
    </div>
  );
}
