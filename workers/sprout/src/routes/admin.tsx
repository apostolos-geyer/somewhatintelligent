import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect } from "react";
import {
  BarChart3,
  BookOpen,
  CalendarDays,
  FolderDown,
  GraduationCap,
  Images,
  Inbox,
  LayoutDashboard,
  Megaphone,
  PackageCheck,
  Settings2,
  Sparkles,
  Star,
  Tag,
} from "lucide-react";
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
import { BrandLogo } from "@/components/brand/BrandLogo";
import { portalEntryUrl } from "@/lib/brand-resolution";
import { probeBrandAdmin } from "@/lib/brand.functions";
import { authClient } from "@/lib/auth-client";

/**
 * The Brand-Admin chrome — a pathless guard layout. `beforeLoad` requires a
 * session (else → identity sign-in with a `returnTo`), then authorizes the
 * caller against the VIEWED brand's admin authority via the
 * `requireBrandAdmin`-gated `probeBrandAdmin`: the gate throws (`notFound`)
 * for a signed-in non-admin of the viewed brand (member / budtender / staff /
 * non-member) and resolves for an owner / admin / platform-admin. A rejection bounces the (signed-in) non-admin
 * to the viewed brand's portal landing — never an empty admin shell over a brand
 * they can't administer, and never the old active-org-vs-viewed-brand pin dance.
 *
 * The component adds a live-session re-check (the SSR-seeded session can be stale
 * on SPA navigation), mirroring identity's `_dashboard.tsx`.
 */
/**
 * Client-side memo of the admin authorization probe. This `beforeLoad` re-runs
 * on every navigation WITHIN `/admin/*` (each sidebar click), and the probe is a
 * full server round-trip — cache the pass once per SPA session. Server functions
 * stay individually `requireBrandAdmin`-gated, so this only caches UI admission,
 * not the security boundary; a revoked admin is locked out again on reload (and
 * by every actual data read immediately).
 */
let adminProbePassed: Promise<unknown> | null = null;

async function probeAdminAccess(): Promise<void> {
  if (typeof window === "undefined") {
    await probeBrandAdmin();
    return;
  }
  if (!adminProbePassed) {
    adminProbePassed = probeBrandAdmin().catch((err: unknown) => {
      adminProbePassed = null; // never cache a rejection
      throw err;
    });
  }
  await adminProbePassed;
}

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context, location }) => {
    if (!context.session) {
      const returnTo = encodeURIComponent(`${import.meta.env.SPROUT_URL}${location.href}`);
      throw redirect({
        href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${returnTo}`,
      });
    }
    // Authorize against the VIEWED brand (never the caller's active org). The
    // probe is `requireBrandAdmin`-gated: it throws for a signed-in non-admin of
    // the viewed brand and resolves for an owner / admin / platform-admin. A
    // throw means "signed-in, but not a brand admin here" →
    // bounce to the viewed brand's portal landing rather than render an empty
    // admin shell. (Anonymous callers are already redirected to sign-in above.)
    try {
      await probeAdminAccess();
    } catch {
      const slug = context.brand?.slug ?? null;
      throw redirect({
        href: slug
          ? portalEntryUrl(import.meta.env.SPROUT_URL, slug, "/")
          : `${import.meta.env.SPROUT_URL}/hub`,
      });
    }
  },
  component: AdminLayout,
});

/**
 * The full Brand-Admin IA, grouped: the portal itself, its content surfaces, and
 * day-to-day operations. Declared `as const` so the typed router accepts each
 * `to` as a literal route. Every entry resolves to a built route.
 */
const NAV = [
  {
    label: "Portal",
    items: [
      { to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
      { to: "/admin/setup", label: "Setup", icon: Settings2, exact: false },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/content/drops", label: "Drop Sheet", icon: Tag, exact: false },
      { to: "/admin/content/decks", label: "PK Decks", icon: BookOpen, exact: false },
      { to: "/admin/content/quizzes", label: "Quizzes", icon: GraduationCap, exact: false },
      { to: "/admin/content/assets", label: "Store Assets", icon: FolderDown, exact: false },
      { to: "/admin/content/banners", label: "Banners", icon: Megaphone, exact: false },
      { to: "/admin/content/feed", label: "Media Feed", icon: Images, exact: false },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/admin/fulfilment", label: "Fulfilment", icon: PackageCheck, exact: false },
      { to: "/admin/reviews", label: "Reviews", icon: Star, exact: false },
      { to: "/admin/calls", label: "Calls & Sessions", icon: CalendarDays, exact: false },
      { to: "/admin/inbox", label: "Inbox", icon: Inbox, exact: false },
      { to: "/admin/ai", label: "AI Assistant", icon: Sparkles, exact: false },
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3, exact: false },
    ],
  },
] as const;

function AdminLayout() {
  const { brand, session: ssrSession } = Route.useRouteContext();
  const { data: liveSession, isPending } = authClient.useSession();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (s) => s.pathname });

  const session = liveSession ?? ssrSession;

  // The SSR-seeded session can be stale on SPA navigation; reconcile with the
  // live client session and bounce only when BOTH are absent after the live query
  // settles (mirrors identity's `_dashboard.tsx`). Redirecting on `!liveSession`
  // alone risks the sign-in⇄route bounce loop a transient get-session blip causes.
  useEffect(() => {
    if (!isPending && !liveSession && !ssrSession) {
      void navigate({ href: "/sign-in", replace: true });
    }
  }, [isPending, liveSession, ssrSession, navigate]);

  if (!session) return null;

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <Link to="/admin" className="flex items-center gap-2.5 px-2 py-1.5">
            <Logo layout="compact" size={28} />
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
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
          ))}
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger />
          <span className="text-sm text-muted-foreground">Brand Admin</span>
          <span className="text-muted-foreground/50">/</span>
          <BrandLogo brand={brand} className="text-base" />
        </header>
        {/* `[&>*]:w-full [&>*]:min-w-0` pins each page's root (a flex child here)
            to the content-box width instead of letting it stretch to its
            intrinsic content size on mobile — so wide tables/tab strips scroll
            inside their own `overflow-x-auto` wrappers rather than pushing the
            whole admin surface past the viewport. */}
        <div className="flex min-h-[calc(100svh-3rem)] flex-col p-4 md:p-6 [&>*]:w-full [&>*]:min-w-0">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
