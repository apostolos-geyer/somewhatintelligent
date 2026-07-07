import { createFileRoute, Link, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "@greenroom/ui/components/logo";
import { HeaderUserMenu } from "@greenroom/ui/components/header-user-menu";
import { authClient } from "@/lib/auth-client";
import { NotificationBell } from "@/components/hub/NotificationBell";

/**
 * THE HUB — the ONE Sprout-branded surface. It renders at the bare apex
 * (`sproutportal.ca`), where `RouterContext.brand` is null, so UNLIKE every brand
 * portal (which uses the runtime `<BrandLogo>`) the Hub wears the Sprout wordmark
 * `Logo`. A budtender lands here post-login.
 *
 * Per the journey-report wireframe (02 "THE HUB — FIVE COMPONENTS") the Hub is a
 * SINGLE SCROLLING PAGE under a slim Sprout-branded header — NOT a sidebar of
 * separate routes. The header carries the wordmark + the "Learn Green, Earn
 * Green" line + the notification bell + the account menu; the five components
 * stack in the scroll below (see `hub/index.tsx`). The bell opens the
 * notification feed at `/hub/notifications`.
 *
 * This is a pathless guard layout (clone of `admin.tsx`'s shape): `beforeLoad`
 * requires a session (resolved in `__root.tsx`); with none it redirects to the
 * identity sign-in carrying a `returnTo` back to the Hub.
 */
export const Route = createFileRoute("/hub")({
  beforeLoad: ({ context, location }) => {
    if (!context.session) {
      const returnTo = encodeURIComponent(`${import.meta.env.SPROUT_URL}${location.href}`);
      throw redirect({
        href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${returnTo}`,
      });
    }
    // The Hub is the apex Sprout surface. If we resolved a brand (i.e. we're on a
    // brand host), send the user to the apex Hub rather than rendering the Hub
    // under a brand skin/host.
    if (context.brand) {
      throw redirect({ href: `${import.meta.env.SPROUT_URL}/hub` });
    }
  },
  component: HubLayout,
});

function HubLayout() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();

  // `context.session` (the root beforeLoad result) does NOT re-run on SPA
  // navigation, so it can be stale/unhydrated. Re-check against the LIVE client
  // session here; prefer it, falling back to the SSR session during hydration.
  const session = liveSession ?? ssrSession;

  // Bounce only when there is genuinely no session — live AND SSR both absent
  // after the live query settles (mirrors identity's `_dashboard` guard; a
  // transient get-session failure must not bounce a still-valid SSR session).
  useEffect(() => {
    if (!isPending && !liveSession && !ssrSession) {
      void navigate({ href: "/sign-in", replace: true });
    }
  }, [isPending, liveSession, ssrSession, navigate]);

  const user = session?.user;

  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center gap-3 px-4 md:px-6">
          <Link to="/hub" className="flex items-center gap-3" aria-label="Sprout Hub">
            <Logo layout="compact" size={30} />
            <span className="hidden text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground sm:inline">
              Learn Green, Earn Green
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            {user && (
              <HeaderUserMenu
                user={{ name: user.name, email: user.email, image: user.image }}
                idpAccountUrl={`${import.meta.env.IDENTITY_URL}/account`}
                onSignOut={async () => {
                  await authClient.signOut();
                  window.location.href = `${import.meta.env.SPROUT_URL}/`;
                }}
              />
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 py-8 md:px-6 md:py-10">
        <Outlet />
      </main>
    </div>
  );
}
