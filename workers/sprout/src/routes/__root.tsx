import {
  HeadContent,
  Scripts,
  createRootRouteWithContext,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { RouterContext } from "@/router";
import { resolveFixedMode, themeToStyleVars } from "@/lib/brand";
import { BRAND_RESOLUTION_MODE } from "@/lib/brand-resolution";
import { AuthProvider } from "@/lib/auth-context";
import { resolveHostContext } from "@/lib/host-context";
import { BrandStyle } from "@/components/brand/BrandStyle";
import { BrandFonts } from "@/components/brand/BrandFonts";

import appCss from "@/styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

/** A fixed-mode brand pins ONE appearance regardless of the visitor's system/
 *  stored preference — force it (class + data-theme + color-scheme) so the theme
 *  toggle can't leave the portal on the wrong Sprout base. Mirrors the SSR attrs. */
const forcedModeScript = (mode: "light" | "dark") =>
  `(function(){try{var r=document.documentElement;r.classList.remove('light','dark');r.classList.add('${mode}');r.setAttribute('data-theme','${mode}');r.style.colorScheme='${mode}';}catch(e){}})();`;

export const Route = createRootRouteWithContext<RouterContext>()({
  // Resolve session AND the runtime brand from the request host BEFORE first
  // paint, so the <BrandStyle> theme + <BrandLogo> SSR with the correct brand —
  // no FOUC, no wrong-brand flash. `brand` is null on the apex → the bare apex
  // root ("/") lands on the Sprout-branded Hub (`/hub`); brand hosts keep the
  // `_portal` path unchanged.
  beforeLoad: async ({ location }) => {
    // Session + brand + slug resolve through `resolveHostContext`, which is
    // memoized on the client — this hook re-runs on EVERY soft navigation, and
    // without the memo each one paid three server round-trips before commit.
    const { session, brand: hostBrand, hostSlug } = await resolveHostContext();
    // The Hub + platform-admin console are CROSS-BRAND apex surfaces. In path
    // mode the selected brand rides a cookie on the SAME host as those surfaces,
    // so we must drop the brand here explicitly — otherwise the Hub would wear a
    // brand skin AND its "bounce to the apex Hub" guard would redirect to itself
    // forever (same host). In subdomain mode these paths only ever load on the
    // apex (brand already null), so this is a no-op there.
    const p = location.pathname;
    const isApexSurface =
      BRAND_RESOLUTION_MODE === "path" &&
      (p === "/hub" ||
        p.startsWith("/hub/") ||
        p === "/sprout-admin" ||
        p.startsWith("/sprout-admin/"));
    const brand = isApexSurface ? null : hostBrand;
    // A host/cookie that names a brand which isn't registered (slug present, but
    // no brand resolved) → render the not-found / go-home page. The apex/Hub
    // resolves a null slug, so it's never caught here.
    if (brand === null && !isApexSurface && hostSlug !== null) {
      throw notFound();
    }
    // Bare apex → the Sprout Hub.
    if (brand === null && location.pathname === "/") {
      throw redirect({ to: "/hub" });
    }
    return { session, brand };
  },
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Sprout" },
      { name: "description", content: "Your brand's budtender portal, powered by Sprout." },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  const { session, brand } = Route.useRouteContext();
  // A fixed-mode brand pins ONE palette. Apply it as INLINE custom properties on
  // <html> — element styles beat every stylesheet rule, so the brand skin wins
  // the cascade over Sprout's base (layered) dark tokens, which a `<style>` block
  // does NOT (see BrandStyle). We also force `data-theme` to that mode so any
  // token the brand doesn't override resolves against the matching Sprout base.
  // Adaptive brands keep the mode-reactive `<style>` path unchanged.
  const fixed = brand ? resolveFixedMode(brand.theme) : null;
  const brandVars =
    brand && fixed ? (themeToStyleVars(brand.theme, fixed) as React.CSSProperties) : undefined;
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={fixed ?? undefined}
      data-theme={fixed ?? undefined}
      style={brandVars}
    >
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: fixed ? forcedModeScript(fixed) : THEME_INIT_SCRIPT }}
        />
        {/* Runtime per-org skin: redefines --color-* / --font-* for this brand. */}
        <BrandStyle brand={brand} />
        {/* Pulls in any Google Fonts the brand's theme selected, so --font-* resolves. */}
        <BrandFonts brand={brand} />
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <AuthProvider initialSession={session}>
          {children}
          <TanStackDevtools
            config={{ position: "bottom-right" }}
            plugins={[{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> }]}
          />
          <Scripts />
        </AuthProvider>
      </body>
    </html>
  );
}

function AppError() {
  return <div className="p-8">Something went wrong.</div>;
}

function AppNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-3xl font-bold">Page not found</h1>
      <p className="max-w-sm text-muted-foreground">
        This portal doesn’t exist. Check the address, or head back to Sprout.
      </p>
      <a
        href={`${import.meta.env.SPROUT_URL}/hub`}
        className="rounded-sm bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Go home
      </a>
    </div>
  );
}
