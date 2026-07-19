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
import type { RouterContext } from "@/router";
import { whoAmI } from "@/lib/actor.functions";

import appCss from "@/styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

// The eight planned modules (RFC-0001 D1). Only Overview is built; the rest are
// nav links that resolve to the not-found "coming soon" stub until their tracks
// land. `path` is the app-root path (Operator carries no mount prefix).
const MODULES = [
  { path: "/", label: "Overview", icon: LayoutDashboardIcon, ready: true },
  { path: "/objects", label: "Objects", icon: BoxesIcon, ready: false },
  { path: "/texts", label: "Texts", icon: FileTextIcon, ready: false },
  { path: "/software", label: "Software", icon: TerminalIcon, ready: false },
  { path: "/pages", label: "Pages", icon: LayoutPanelLeftIcon, ready: false },
  { path: "/orders", label: "Orders", icon: ReceiptIcon, ready: true },
  { path: "/media", label: "Media", icon: ImageIcon, ready: false },
  { path: "/settings", label: "Settings", icon: SettingsIcon, ready: false },
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
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-6 py-8">{children}</main>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

function Sidebar() {
  const pathname = useLocation({ select: (s) => s.pathname });
  return (
    <aside className="border-border bg-card hidden w-56 shrink-0 border-r md:block">
      <div className="border-border flex h-14 items-center gap-2 border-b px-5">
        <span className="bg-primary size-2.5 rounded-full" />
        <span className="text-foreground font-mono text-sm font-medium tracking-tight">
          operator
        </span>
      </div>
      <nav className="flex flex-col gap-0.5 p-3">
        {MODULES.map((m) => {
          const active = pathname === m.path;
          const Icon = m.icon;
          const className =
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors " +
            (active
              ? "bg-muted text-foreground font-medium"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60");
          const inner = (
            <>
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{m.label}</span>
              {!m.ready && (
                <span className="text-muted-foreground/70 font-mono text-[10px] uppercase">
                  soon
                </span>
              )}
            </>
          );
          // Built modules use the typed router Link; not-yet-built modules are
          // plain links that land on the "coming soon" not-found stub.
          return m.ready ? (
            <Link key={m.path} to={m.path} className={className}>
              {inner}
            </Link>
          ) : (
            <a key={m.path} href={m.path} className={className}>
              {inner}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}

function Topbar() {
  const { actor } = Route.useRouteContext();
  return (
    <header className="border-border flex h-14 shrink-0 items-center justify-between gap-4 border-b px-6">
      <span className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
        control plane
      </span>
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
