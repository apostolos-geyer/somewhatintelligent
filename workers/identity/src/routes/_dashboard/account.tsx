import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Badge } from "@si/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@si/ui/components/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@si/ui/components/item";
import { ChevronRightIcon } from "lucide-react";
import { GridLine } from "@si/ui/components/grid-line";
import { ChangePasswordDialog } from "@/components/account/change-password-dialog";
import { DeleteAccountDialog } from "@/components/account/delete-account-dialog";
import { IdentityCard, type IdentityUser } from "@/components/account/identity-card";
import { TwoFactorDialog } from "@/components/account/two-factor-dialog";

const manageItems = [
  { to: "/account/sessions", label: "Sessions", description: "Devices currently signed in" },
  { to: "/account/passkeys", label: "Passkeys", description: "Biometrics or security keys" },
  { to: "/account/api-keys", label: "API Keys", description: "For programmatic access" },
  { to: "/account/providers", label: "Providers", description: "Linked sign-in methods" },
] as const;

export const Route = createFileRoute("/_dashboard/account")({
  head: () => ({ meta: [{ title: "Account — Identity" }] }),
  component: AccountLayout,
});

// The account hub renders unconditionally as the persistent background;
// sub-pages (sessions/passkeys/api-keys/providers) match into the `Outlet`
// below and render themselves inside a `Sheet`, so the hub stays visible
// (dimmed, behind the overlay) rather than being replaced by a full page.
function AccountLayout() {
  const { session } = Route.useRouteContext();
  const user = session!.user;
  const twoFactorEnabled = user.twoFactorEnabled ?? false;

  const identityUser: IdentityUser = {
    name: user.name,
    username: (user as { username?: string | null }).username ?? null,
    email: user.email,
    emailVerified: user.emailVerified ?? false,
    image: user.image ?? null,
    role: user.role ?? null,
    createdAt: user.createdAt,
  };

  return (
    <div className="relative flex flex-1 flex-col gap-grid">
      <GridLine orientation="vertical" className="left-0" />
      <GridLine orientation="vertical" className="right-0" />

      <GridLine />

      <IdentityCard user={identityUser} />

      <GridLine />

      <Card>
        <CardHeader>
          <CardTitle>Security</CardTitle>
          <CardDescription>How you prove you are who you claim to be.</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item variant="surface" size="default">
              <ItemContent>
                <ItemTitle>Password</ItemTitle>
                <ItemDescription>
                  Change your password. Other sessions will be revoked.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChangePasswordDialog />
              </ItemActions>
            </Item>
            <Item variant="surface" size="default">
              <ItemContent>
                <ItemTitle>
                  <span className="flex items-center gap-2">
                    Two-Factor
                    {twoFactorEnabled ? (
                      <Badge variant="success" size="sm">
                        On
                      </Badge>
                    ) : (
                      <Badge variant="secondary" size="sm">
                        Off
                      </Badge>
                    )}
                  </span>
                </ItemTitle>
                <ItemDescription>An additional layer of verification.</ItemDescription>
              </ItemContent>
              <ItemActions>
                <TwoFactorDialog enabled={twoFactorEnabled} />
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <GridLine />

      <Card>
        <CardHeader>
          <CardTitle>Manage</CardTitle>
          <CardDescription>Sessions, credentials, and access.</CardDescription>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            {manageItems.map((item) => (
              <Link key={item.to} to={item.to}>
                <Item variant="surface" size="default" className="cursor-pointer">
                  <ItemContent>
                    <ItemTitle>{item.label}</ItemTitle>
                    <ItemDescription>{item.description}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ChevronRightIcon className="size-4 text-text-tertiary" />
                  </ItemActions>
                </Item>
              </Link>
            ))}
          </ItemGroup>
        </CardContent>
      </Card>

      <GridLine />

      <Card>
        <CardHeader>
          <CardTitle>Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <ItemGroup>
            <Item variant="surface" size="default">
              <ItemContent>
                <ItemTitle>Delete Account</ItemTitle>
                <ItemDescription>
                  Permanently remove your account and all associated data
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <DeleteAccountDialog />
              </ItemActions>
            </Item>
          </ItemGroup>
        </CardContent>
      </Card>

      <Outlet />
    </div>
  );
}
