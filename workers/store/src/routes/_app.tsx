import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

// Authenticated shell. No local sign-in page — unauthenticated users bounce to
// identity, and the cross-subdomain cookie usually means they're already in.
export const Route = createFileRoute("/_app")({
  beforeLoad: ({ context, location }) => {
    if (context.session) return;
    const returnTo = `${import.meta.env.STOREFRONT_URL}${location.href}`;
    throw redirect({
      href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    });
  },
  component: () => (
    <main className="min-h-[calc(100vh-4rem)]">
      <Outlet />
    </main>
  ),
});
