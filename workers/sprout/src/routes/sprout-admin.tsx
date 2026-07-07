import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, BadgeCheck, LayoutGrid, type LucideIcon } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@greenroom/ui/components/sidebar";
import { Logo } from "@greenroom/ui/components/logo";
import { Badge } from "@greenroom/ui/components/badge";
import { HeaderUserMenu } from "@greenroom/ui/components/header-user-menu";
import { isAdminRole } from "@greenroom/kit/roles";
import { authClient } from "@/lib/auth-client";

/**
 * THE SPROUT-ADMIN chrome — the platform-operator (god-mode) console, gated on
 * the platform-admin role. UNLIKE `/admin` (which is BRAND-scoped and wears the
 * runtime `<BrandLogo>`), this surface wears the Sprout wordmark `Logo` like the
 * Hub: it is cross-brand, NOT a tenant view. Its OWN guard (mirrors `hub.tsx`'s
 * shape + identity's `_dashboard/admin.tsx` client-settle pattern), separate from
 * the brand `admin.tsx` guard.
 *
 * Two-stage gate, because `context.session` is the root `beforeLoad` result that
 * does NOT re-run on SPA navigation (can be stale/unhydrated):
 *  1. `beforeLoad` hard-bounces only a DEFINITIVE non-admin session — a known
 *     session whose role isn't admin → home. An unknown/absent session is left
 *     to the component (never bounce during the hydration window).
 *  2. The component resolves the live client session and bounces a settled
 *     non-admin, rendering the console only once the viewer is positively an
 *     admin (no admin-UI flash to non-admins, no false bounce of real admins).
 *
 * The server functions enforce the same gate independently (`requireAdminMiddleware`),
 * so this is defense-in-depth UI cloaking, not the security boundary.
 */
export const Route = createFileRoute("/sprout-admin")({
  beforeLoad: ({ context, location }) => {
    // No session at all → identity sign-in, carrying a returnTo back here.
    if (!context.session) {
      const returnTo = encodeURIComponent(`${import.meta.env.SPROUT_URL}${location.href}`);
      throw redirect({
        href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${returnTo}`,
      });
    }
    // Definitive non-admin → home. Unknown role is resolved in the component.
    if (!isAdminRole(context.session.user.role)) {
      throw redirect({ to: "/" });
    }
  },
  component: SproutAdminLayout,
});

/** The console's nav. Both sections live; the IA stays flat (one cross-brand
 * overview + the org-provisioning form share the index this phase). */
const NAV: ReadonlyArray<{
  to: "/sprout-admin" | "/sprout-admin/credentials";
  label: string;
  icon: LucideIcon;
  exact: boolean;
}> = [
  { to: "/sprout-admin", label: "Overview", icon: LayoutGrid, exact: true },
  { to: "/sprout-admin/credentials", label: "CanSell review", icon: BadgeCheck, exact: true },
];

function SproutAdminLayout() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession } = authClient.useSession();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (s) => s.pathname });

  // beforeLoad already guaranteed an admin SSR session; the LIVE client session
  // (once hydrated) is the re-check — `context.session` does NOT re-run on SPA
  // navigation, so it can be stale. Prefer the live session, fall back to SSR.
  const session = liveSession ?? ssrSession;
  const user = session?.user;
  const isAdmin = isAdminRole(user?.role);

  // Bounce a settled non-admin once the live session has hydrated (the server
  // fns enforce requireAdminMiddleware independently — this is UI cloaking).
  useEffect(() => {
    if (liveSession && !isAdminRole(liveSession.user.role)) {
      void navigate({ to: "/", replace: true });
    }
  }, [liveSession, navigate]);

  // Render the console only while the viewer is (still) an admin.
  if (!isAdmin) return null;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/sprout-admin" className="flex items-center gap-2.5 px-2 py-1.5">
            <Logo layout="compact" size={28} />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Platform</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      isActive={
                        item.exact
                          ? pathname === item.to
                          : pathname === item.to || pathname.startsWith(`${item.to}/`)
                      }
                      render={<Link to={item.to} />}
                    >
                      <item.icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <Activity className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-sm text-muted-foreground">Sprout Admin</span>
          <Badge variant="sprout-glass" className="ml-1">
            Platform
          </Badge>
          {user && (
            <div className="ml-auto">
              <HeaderUserMenu
                user={{ name: user.name, email: user.email, image: user.image }}
                idpAccountUrl={`${import.meta.env.IDENTITY_URL}/account`}
                onSignOut={async () => {
                  await authClient.signOut();
                  window.location.href = `${import.meta.env.SPROUT_URL}/`;
                }}
              />
            </div>
          )}
        </header>
        <div className="flex min-h-[calc(100svh-3rem)] flex-col p-4 md:p-6">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
