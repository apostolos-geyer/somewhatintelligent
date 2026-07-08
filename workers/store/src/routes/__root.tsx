import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { AnalyticsProvider } from "@si/analytics/client";
import type { RouterContext } from "@/router";
import { AppError, AppNotFound } from "@/components/app-status-pages";
import { StoreFrame } from "@/components/store-frame";
import { PageFrame } from "@si/ui/components/page-frame";
import { Toaster } from "@/components/toaster";
import { AuthProvider } from "@/lib/auth-context";
import { loadSession } from "@/lib/session.functions";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/config";

import appCss from "@/styles.css?url";

// Dark is the only theme — no light/auto branch, no stored preference to
// resolve. Kept as an init script (not just a CSS default) so there's no
// flash of an unstyled/light document before hydration.
const THEME_INIT_SCRIPT = `(function(){try{var root=document.documentElement;root.classList.remove('light');root.classList.add('dark');root.setAttribute('data-theme','dark');root.style.colorScheme='dark';}catch(e){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async () => {
    const session = await loadSession();
    return { session };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "theme-color", content: "#0a0a0a" },
      { title: `${BRAND_NAME} — shop` },
      { name: "description", content: BRAND_TAGLINE },
      { property: "og:type", content: "website" },
      { property: "og:title", content: `${BRAND_NAME} — shop` },
      { property: "og:description", content: BRAND_TAGLINE },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { session } = Route.useRouteContext();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
        <AnalyticsProvider app="store" environment={import.meta.env.ENVIRONMENT} session={session}>
          <AuthProvider initialSession={session}>
            <StoreFrame />
            <PageFrame className="max-w-6xl">{children}</PageFrame>
            <Toaster position="top-right" />
          </AuthProvider>
          <Scripts />
        </AnalyticsProvider>
      </body>
    </html>
  );
}
