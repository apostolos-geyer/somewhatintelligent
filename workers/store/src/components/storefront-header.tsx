import { Link } from "@tanstack/react-router";
import { ShoppingBagIcon, ShirtIcon } from "lucide-react";
import { Badge } from "@si/ui/components/badge";
import { Button } from "@si/ui/components/button";
import { ThemeToggle } from "@si/ui/components/theme-toggle";
import { isAdminRole } from "@somewhatintelligent/kit/roles";
import { useAuth } from "@/lib/auth-context";
import { useCart } from "@/lib/cart";
import { BRAND_NAME } from "@/lib/config";

export function StorefrontHeader() {
  const { session } = useAuth();
  const { count } = useCart();
  const isAdmin = isAdminRole(session?.user.role);

  const signInHref = `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.href : import.meta.env.STORE_URL,
  )}`;

  return (
    <header className="border-border bg-background sticky top-0 z-20 border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 md:px-6">
        <Link
          to="/"
          className="text-foreground flex items-center gap-2 font-semibold tracking-tight"
        >
          <ShirtIcon className="text-primary size-5" />
          <span className="font-display text-lg">{BRAND_NAME}</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex">
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/" />}>
            Shop
          </Button>
          {session && (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/orders" />}>
              My orders
            </Button>
          )}
          {isAdmin && (
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link to="/admin" />}>
              Admin
            </Button>
          )}
        </nav>

        <div className="flex flex-1 items-center justify-end gap-2">
          <ThemeToggle />
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
              <Badge variant="inverse" size="sm" className="ml-1">
                {count}
              </Badge>
            )}
          </Button>
          {session ? (
            <span className="text-muted-foreground hidden font-mono text-xs sm:inline">
              {session.user.name ?? session.user.email}
            </span>
          ) : (
            <Button size="sm" nativeButton={false} render={<a href={signInHref} />}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
