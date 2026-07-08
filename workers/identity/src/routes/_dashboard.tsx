import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  UserIcon,
  LinkIcon,
  LayoutDashboardIcon,
  UsersIcon,
  KeyIcon,
  ActivityIcon,
  KeyRoundIcon,
  Building2Icon,
} from "lucide-react";
import { AppFrame, type FabMenuGroup } from "@si/ui/components/app-frame";
import { PageFrame } from "@si/ui/components/page-frame";
import type { PlatformApp } from "@si/ui/components/platform-nav";
import { useCapture } from "@si/analytics/client";
import { toast } from "@si/ui/components/sonner";
import { DashboardBreadcrumb } from "@/components/dashboard/dashboard-breadcrumb";
import { OrgSwitcher } from "@/components/header/org-switcher";
import { authClient } from "@/lib/auth-client";
import { isAdminRole } from "@si/kit/roles";

// Only the apps this fork actually ships. The source template shipped extra
// demo apps that don't exist here (they had no URL → dead links). "home" is
// same-host root: bouncer redirects `/` to the (not-yet-built) storefront.
const APPS: PlatformApp[] = [
  { id: "home", label: "home", href: "/" },
  { id: "identity", label: "identity", href: import.meta.env.IDENTITY_URL, current: true },
];

const accountGroup: FabMenuGroup = {
  label: "Account",
  items: [
    { href: "/account", label: "Account", icon: UserIcon },
    { href: "/connections", label: "Connections", icon: LinkIcon },
  ],
};

const adminGroup: FabMenuGroup = {
  label: "Administration",
  items: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
    { href: "/admin/users", label: "Users", icon: UsersIcon },
    { href: "/admin/orgs", label: "Organizations", icon: Building2Icon },
    { href: "/admin/clients", label: "OAuth Clients", icon: KeyIcon },
    { href: "/admin/sessions", label: "Sessions", icon: ActivityIcon },
    { href: "/admin/api-keys", label: "API Keys", icon: KeyRoundIcon },
  ],
};

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
});

function DashboardLayout() {
  const { session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const capture = useCapture();

  const session = liveSession ?? ssrSession;

  // Only bounce to sign-in when there is genuinely no session — live AND SSR
  // both absent (after the live query settles). Redirecting on `!liveSession`
  // alone caused an infinite loop: a transient client get-session failure left
  // the valid SSR session in place, so /sign-in (which gates on the SSR
  // session) bounced straight back here, and round and round.
  useEffect(() => {
    if (!isPending && !liveSession && !ssrSession) {
      void navigate({ href: "/sign-in", replace: true });
    }
  }, [isPending, liveSession, ssrSession, navigate]);

  if (!session) return null;

  const user = {
    name: session.user.name ?? "User",
    email: session.user.email,
    role: session.user.role ?? null,
  };
  const groups = isAdminRole(user.role) ? [accountGroup, adminGroup] : [accountGroup];

  async function handleSignOut() {
    capture("signed_out", {});
    const result = await authClient.signOut();
    if (result.error) {
      toast.error(result.error.message ?? "Failed to sign out");
      return;
    }
    void navigate({ to: "/sign-in" });
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppFrame>
        <AppFrame.Brand
          current={{ id: "identity", label: "identity" }}
          apps={APPS}
          linkComponent={Link}
        />
        <AppFrame.Title>
          <DashboardBreadcrumb />
        </AppFrame.Title>
        <AppFrame.Right>
          <OrgSwitcher isAdmin={isAdminRole(user.role)} />
        </AppFrame.Right>
      </AppFrame>
      <PageFrame className="flex flex-col">
        <div className="flex min-h-[calc(100svh-52px)] flex-1 flex-col p-page">
          <Outlet />
        </div>
      </PageFrame>
      <AppFrame.Fab groups={groups} user={user} onSignOut={handleSignOut} linkComponent={Link} />
    </div>
  );
}
