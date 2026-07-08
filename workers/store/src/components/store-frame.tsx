import { Link } from "@tanstack/react-router";
import { ShoppingBagIcon, ShirtIcon, BoxIcon, LayoutDashboardIcon } from "lucide-react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { AppFrame, type FabMenuGroup } from "@si/ui/components/app-frame";
import type { PlatformApp } from "@si/ui/components/platform-nav";
import { isAdminRole } from "@si/kit/roles";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart";

// Same shared shell as identity — see `packages/ui/src/components/ui/app-frame.tsx`.
// Rendered once at the root, above both `_public` and `_app` outlets, so the
// FAB nav appears on the public storefront too, not just authed/admin pages.
const APPS: PlatformApp[] = [
  { id: "store", label: "shop", href: "/", current: true },
  { id: "identity", label: "account", href: import.meta.env.IDENTITY_URL },
];

const shopGroup: FabMenuGroup = {
  label: "Shop",
  items: [{ href: "/", label: "Shop", icon: ShirtIcon }],
};

const adminGroup: FabMenuGroup = {
  label: "Administration",
  items: [
    { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
    { href: "/admin/products", label: "Catalog", icon: ShirtIcon },
    { href: "/admin/orders", label: "Orders", icon: BoxIcon },
  ],
};

export function StoreFrame() {
  const { session } = useAuth();
  const { count } = useCart();
  const isAdmin = isAdminRole(session?.user.role);

  const signInHref = `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : import.meta.env.STORE_URL,
  )}`;

  const groups: FabMenuGroup[] = [
    session
      ? {
          label: "Shop",
          items: [...shopGroup.items, { href: "/orders", label: "My Orders", icon: BoxIcon }],
        }
      : shopGroup,
  ];
  if (isAdmin) groups.push(adminGroup);

  return (
    <>
      <AppFrame>
        <AppFrame.Brand current={{ id: "store", label: "shop" }} apps={APPS} linkComponent={Link} />
        <AppFrame.Right>
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link to="/cart" />}
            className="relative"
          >
            <ShoppingBagIcon className="size-4" />
            Cart
            {count > 0 && (
              <Badge variant="contrast" size="sm" className="ml-1">
                {count}
              </Badge>
            )}
          </Button>
          {!session && (
            <Button size="sm" nativeButton={false} render={<a href={signInHref} />}>
              Sign in
            </Button>
          )}
        </AppFrame.Right>
      </AppFrame>
      <AppFrame.Fab
        groups={groups}
        user={
          session
            ? { name: session.user.name ?? session.user.email, email: session.user.email }
            : undefined
        }
        linkComponent={Link}
      />
    </>
  );
}
