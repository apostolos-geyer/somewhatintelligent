import { Logo } from "./logo";
import { Button } from "./button";
import { HeaderUserMenu } from "./header-user-menu";

interface SiteHeaderProps {
  siteTitle: string;
  user?: { name: string; email: string; image?: string | null } | null;
  signInHref?: string;
  idpAccountUrl?: string;
  onSignOut?: () => Promise<void> | void;
  appMenuItems?: React.ReactNode;
  linkComponent?: React.ElementType;
}

export function SiteHeader({
  siteTitle,
  user,
  signInHref = "/sign-in",
  idpAccountUrl,
  onSignOut,
  appMenuItems,
  linkComponent: LinkComp = "a",
}: SiteHeaderProps) {
  return (
    <header
      className="sticky top-0 z-50 border-b border-border bg-background"
      style={{ viewTransitionName: "site-header" }}
    >
      <div className="relative mx-auto flex h-14 max-w-content items-center px-page">
        <LinkComp href="/" className="shrink-0">
          <Logo layout="horizontal" size={32} />
        </LinkComp>

        <span className="absolute left-1/2 -translate-x-1/2 font-heading text-sm font-semibold tracking-wide uppercase text-text-secondary">
          {siteTitle}
        </span>

        <div className="flex-1" />

        {user ? (
          <HeaderUserMenu user={user} idpAccountUrl={idpAccountUrl} onSignOut={onSignOut}>
            {appMenuItems}
          </HeaderUserMenu>
        ) : (
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<LinkComp href={signInHref} />}
          >
            Sign In
          </Button>
        )}
      </div>
    </header>
  );
}
