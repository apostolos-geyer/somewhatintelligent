import type { ReactNode } from "react";
import {
  HeadContent,
  Link,
  Scripts,
  createRootRouteWithContext,
  useLocation,
} from "@tanstack/react-router";
import {
  BoxesIcon,
  FileTextIcon,
  ImageIcon,
  LayoutDashboardIcon,
  LayoutPanelLeftIcon,
  ReceiptIcon,
  SettingsIcon,
  TerminalIcon,
} from "lucide-react";
import { Badge } from "@si/ui/components/badge";
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
  SidebarTrigger,
} from "@si/ui/components/sidebar";
import { Toaster } from "@si/ui/components/sonner";
import type { RouterContext } from "@/router";
import { whoAmI } from "@/lib/actor.functions";

import appCss from "@/styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

// The eight console modules (RFC-0001 D1). `path` is the app-root path (Operator
// carries no mount prefix); each resolves to a built route.
const MODULES = [
  { path: "/", label: "Overview", icon: LayoutDashboardIcon },
  { path: "/objects", label: "Objects", icon: BoxesIcon },
  { path: "/texts", label: "Texts", icon: FileTextIcon },
  { path: "/software", label: "Software", icon: TerminalIcon },
  { path: "/pages", label: "Pages", icon: LayoutPanelLeftIcon },
  { path: "/orders", label: "Orders", icon: ReceiptIcon },
  { path: "/media", label: "Media", icon: ImageIcon },
  { path: "/settings", label: "Settings", icon: SettingsIcon },
] as const;

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const { actor } = await whoAmI();
    return { actor };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0a0a0a" },
      { name: "robots", content: "noindex, nofollow" },
      { title: "Operator" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  notFoundComponent: ComingSoon,
  errorComponent: RootError,
});

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      {/* App frame: viewport-height, top-level overflow clipped. The sidebar and
          topbar stay fixed; scrolling lives in the inner content region (and, on
          the dashboard, inside each panel). */}
      <body className="bg-background text-foreground font-sans antialiased">
        <SidebarProvider className="h-dvh overflow-hidden">
          <AppSidebar />
          <SidebarInset className="min-h-0 overflow-hidden">
            <Topbar />
            <div className="min-h-0 flex-1 overflow-auto px-6 py-8">{children}</div>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
        <Scripts />
      </body>
    </html>
  );
}

// The console shell (RFC-0001 D1) on @si/ui's Sidebar: collapsible off-canvas,
// Cmd/Ctrl+B toggle, mobile sheet, cookie-persisted — driven by the MODULES nav.
function AppSidebar() {
  const pathname = useLocation({ select: (s) => s.pathname });
  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-1">
          <span className="bg-primary size-2.5 shrink-0 rounded-full" />
          <span className="text-foreground font-mono text-sm font-medium tracking-tight">
            operator
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-wider">
            Modules
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MODULES.map((m) => {
                const active = m.path === "/" ? pathname === "/" : pathname.startsWith(m.path);
                const Icon = m.icon;
                return (
                  <SidebarMenuItem key={m.path}>
                    <SidebarMenuButton isActive={active} render={<Link to={m.path} />}>
                      <Icon />
                      <span>{m.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

function Topbar() {
  const { actor } = Route.useRouteContext();
  return (
    <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="-ml-2" />
        <span className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
          control plane
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="font-mono text-[10px] uppercase">
          {import.meta.env.ENVIRONMENT ?? "development"}
        </Badge>
        <span className="text-muted-foreground hidden text-xs sm:inline">{actor?.email}</span>
      </div>
    </header>
  );
}

function ComingSoon() {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">module</p>
      <h1 className="text-foreground mt-3 text-2xl font-light tracking-tight">Coming soon</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        This console module has not been built yet.
      </p>
    </div>
  );
}

function RootError({ error }: { error: Error }) {
  return (
    <div className="mx-auto max-w-lg py-24 text-center">
      <h1 className="text-foreground text-2xl font-light tracking-tight">Something went wrong</h1>
      <p className="text-muted-foreground mt-2 font-mono text-xs">{error.message}</p>
    </div>
  );
}
