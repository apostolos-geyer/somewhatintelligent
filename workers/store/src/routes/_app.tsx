import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { storeOpenFor } from "@/lib/store-gate";

// Authenticated shell. No local sign-in page — unauthenticated users bounce to
// identity, and the cross-subdomain cookie usually means they're already in.
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      const returnTo = `${import.meta.env.STORE_URL}${location.href}`;
      throw redirect({
        href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
      });
    }
    // Pre-launch gate: signed-in non-admins can't reach checkout/orders; the
    // sign-in bounce above stays so an admin can still log in via /admin.
    if (!storeOpenFor(context.session)) throw redirect({ to: "/" });
  },
  component: () => (
    <main className="min-h-[calc(100vh-4rem)]">
      <Outlet />
    </main>
  ),
});
