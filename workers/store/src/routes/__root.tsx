import { HeadContent, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { PostHogProvider } from "@posthog/react";
import type { RouterContext } from "@/router";
import { AppError, AppNotFound } from "@/components/app-status-pages";
import { StorefrontHeader } from "@/components/storefront-header";
import { Toaster } from "@/components/toaster";
import { AuthProvider } from "@/lib/auth-context";
import { loadSession } from "@/lib/session.functions";
import { BRAND_NAME, BRAND_TAGLINE } from "@/lib/config";

import appCss from "@/styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

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
        <PostHogProvider
          apiKey={import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN!}
          options={{
            api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
            defaults: "2026-05-30",
            capture_exceptions: true,
            debug: import.meta.env.DEV,
          }}
        >
          <AuthProvider initialSession={session}>
            <StorefrontHeader />
            {children}
            <Toaster position="top-right" />
          </AuthProvider>
        </PostHogProvider>
        <Scripts />
      </body>
    </html>
  );
}
