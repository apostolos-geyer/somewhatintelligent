import { Link, useLocation } from "@tanstack/react-router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarRail,
  SidebarSeparator,
} from "@si/ui/components/sidebar";
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
import { PlatformNav, type PlatformApp } from "@si/ui/components/platform-nav";
import type { PlatformSession } from "@si/auth";
import { SidebarUserMenu } from "@/components/dashboard/sidebar-user-menu";
import { isAdminRole } from "@si/kit/roles";

// Only the apps this fork actually ships. The source template shipped extra
// demo apps that don't exist here (they had no URL → dead links). "home" is
// same-host root: bouncer redirects `/` to the (not-yet-built) storefront.
const APPS: PlatformApp[] = [
  { id: "home", label: "home", href: "/" },
  { id: "identity", label: "identity", href: import.meta.env.IDENTITY_URL, current: true },
];

const accountNav = [
  { href: "/account", label: "Account", icon: UserIcon },
  { href: "/connections", label: "Connections", icon: LinkIcon },
] as const;

const adminNav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
  { href: "/admin/users", label: "Users", icon: UsersIcon },
  { href: "/admin/orgs", label: "Organizations", icon: Building2Icon },
  { href: "/admin/clients", label: "OAuth Clients", icon: KeyIcon },
  { href: "/admin/sessions", label: "Sessions", icon: ActivityIcon },
  { href: "/admin/api-keys", label: "API Keys", icon: KeyRoundIcon },
] as const;

function isActive(pathname: string, href: string, isIndex: boolean) {
  if (isIndex) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar({ session }: { session: PlatformSession }) {
  const pathname = useLocation({ select: (s) => s.pathname });

  const user = {
    name: session.user.name ?? "User",
    email: session.user.email,
    role: session.user.role ?? null,
    image: session.user.image ?? null,
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <PlatformNav.AppSwitcher
          current={{ id: "identity", label: "identity" }}
          apps={APPS}
          linkComponent={Link}
          triggerClassName="hover:bg-sidebar-accent flex items-center gap-2.5 rounded-md px-2 py-1.5"
        />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {accountNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(pathname, item.href, item.href === "/account")}
                    render={<Link to={item.href} />}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdminRole(user.role) && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Administration</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminNav.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive(pathname, item.href, item.href === "/admin")}
                        render={<Link to={item.href} />}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarUserMenu user={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
