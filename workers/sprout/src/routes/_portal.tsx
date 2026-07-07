import { useState, type ReactNode } from "react";
import { Link, Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { AiBubble } from "@/components/shell/AiBubble";
import { DemoMode } from "@/components/admin/DemoMode";
import { BannerRail, type BannerCardData } from "@/components/shell/BannerRail";
import { LayerStack } from "@/components/shell/LayerStack";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import { BrandLogo } from "@/components/brand/BrandLogo";
import {
  dismissBanner,
  listActiveBanners,
  recordBannerClick,
  recordBannerImpression,
} from "@/lib/landing.functions";
import type { SectionKey } from "@/lib/sections";
import { getPortalContent } from "@/lib/brand.functions";
import { DEFAULT_FEED_LABEL, type PortalContent } from "@/lib/brand";
import { getMyBrandRole, getMyOrgRole } from "@/lib/portal.functions";

/**
 * The ONE-PAGE portal SHELL — a pathless layout route. It persistently mounts the
 * BannerRail, AiBubble, and the LayerStack so they survive section-layer
 * open/close. The `<Outlet/>` is the single portal page (`_portal/index`): the
 * hero and the section grid stacked in one vertical scroll. Sections open as
 * search-param layers over the outlet, never as route changes — see
 * `components/shell/use-layer-stack`.
 *
 * The portal is AUDIENCE-ONLY (plan doc D4b): its reads — the banner rail here
 * and the child landing's hero slides (`listHeroSlides`) — are all gated behind
 * `requireBrandAudience`. A signed-OUT visitor can render no portal content, so
 * the loader bounces them to identity sign-in; a signed-IN non-member's gated
 * read throws `notFound()`, which surfaces as the root's not-found shell.
 */
export const Route = createFileRoute("/_portal")({
  loader: async ({ context, location }) => {
    // Signed-out: no gated read can resolve (banners AND the child hero are
    // audience-only), so bounce to identity sign-in with a returnTo — mirroring
    // admin.tsx's beforeLoad guard — rather than rendering an empty shell.
    if (!context.session) {
      throw redirect({
        href: `${import.meta.env.IDENTITY_URL}/sign-in?returnTo=${encodeURIComponent(
          `${import.meta.env.SPROUT_URL}${location.href}`,
        )}`,
      });
    }
    // Signed-in: fetch banners + roles + the portal CONTENT config in parallel —
    // independent reads. `orgRole` (admin authority) gates the Admin entry;
    // `brandRole` is the portal-member standing (its read lazily folds org staff
    // into the audience); `content` is the page-shape config (tagline, feed
    // label, section toggles) that used to ride the root/blocking BrandRuntime.
    // A NON-member's gated call throws `notFound()` (`requireBrandAudience` does
    // `if (!res.ok) throw notFound()`); Promise.all propagates that first
    // rejection and the loader doesn't swallow it, so it surfaces as the root's
    // not-found shell — intentionally NO silently-empty portal for a non-member.
    const [banners, orgRole, brandRole, content] = await Promise.all([
      listActiveBanners(),
      getMyOrgRole(),
      getMyBrandRole(),
      getPortalContent(),
    ]);
    const fallbackContent: PortalContent = {
      tagline: "",
      feedLabel: DEFAULT_FEED_LABEL,
      sections: [],
    };
    return { banners, orgRole, brandRole, content: content ?? fallbackContent };
  },
  component: PortalShell,
});

function PortalShell() {
  const { brand } = Route.useRouteContext();
  const { banners, orgRole } = Route.useLoaderData();
  const isAdmin = orgRole === "owner" || orgRole === "admin";
  return (
    <div className="relative flex min-h-dvh flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-page py-3">
        <BrandLogo brand={brand} />
        <nav className="flex items-center gap-2 text-sm">
          {isAdmin && (
            <Link
              to="/admin"
              className="rounded-sm px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Admin
            </Link>
          )}
          <a
            href={`${import.meta.env.SPROUT_URL}/hub`}
            className="rounded-sm px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Hub
          </a>
        </nav>
      </header>
      {/* Hero/content stays at the TOP; banners flank it as sticky LEFT + RIGHT
          rails on desktop, collapsing to strips BELOW the hero on mobile (main is
          order-first). Never a fixed overlay — they never float over the content.
          Mirrors the MTL mockup's `rail | hero | rail` layout, responsively. */}
      <PortalBanners initial={banners}>
        <main className="order-first flex min-w-0 flex-1 flex-col lg:order-none">
          <Outlet />
        </main>
      </PortalBanners>
      <AiBubble />
      {brand && <DemoMode isAdmin={isAdmin} orgId={brand.orgId} />}
      <LayerStack />
      <footer className="shrink-0 border-t border-border px-page py-3 text-center text-xs text-muted-foreground">
        Powered by Sprout
      </footer>
    </div>
  );
}

/**
 * The 3-column portal frame: a LEFT banner rail, the hero/content `children` in
 * the center, and a RIGHT banner rail. Owns the banner engagement wiring the
 * presentational `BannerRail` stays free of:
 *  - first-paint impressions → `recordBannerImpression`,
 *  - in-platform open (`onOpen`) → `recordBannerClick` then `openLayer`,
 *  - dismiss → optimistic local removal + `dismissBanner` (sticky).
 *
 * Banners split across the two rails (even → left, odd → right). Rails are sticky
 * side columns on desktop and collapse BELOW the hero on mobile (the center keeps
 * `order-first`). Fire-and-forget write failures are swallowed — analytics must
 * never break the surface.
 */
function PortalBanners({ initial, children }: { initial: BannerCardData[]; children: ReactNode }) {
  const [banners, setBanners] = useState(initial);
  const { openLayer } = useLayerStack();

  const onImpression = (bannerId: string) => {
    void recordBannerImpression({ data: { bannerId } }).catch(() => {});
  };

  const onOpen = (section: SectionKey, item?: string) => {
    const banner = banners.find((b) => b.section === section && (b.item ?? undefined) === item);
    if (banner) {
      void recordBannerClick({ data: { bannerId: banner.id, section } }).catch(() => {});
    }
    void openLayer(section, item);
  };

  const onDismiss = (bannerId: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== bannerId));
    void dismissBanner({ data: { bannerId } }).catch(() => {});
  };

  const left = banners.filter((_, i) => i % 2 === 0);
  const right = banners.filter((_, i) => i % 2 === 1);
  const handlers = { onOpen, onDismiss, onImpression };

  return (
    <div className="flex flex-1 flex-col lg:flex-row">
      <BannerColumn banners={left} {...handlers} />
      {children}
      <BannerColumn banners={right} {...handlers} />
    </div>
  );
}

/** One sticky side rail (desktop) / below-hero strip (mobile). Null when empty. */
function BannerColumn({
  banners,
  onOpen,
  onDismiss,
  onImpression,
}: {
  banners: BannerCardData[];
  onOpen: (section: SectionKey, item?: string) => void;
  onDismiss: (bannerId: string) => void;
  onImpression: (bannerId: string) => void;
}) {
  if (banners.length === 0) return null;
  return (
    <aside className="w-full shrink-0 p-4 lg:sticky lg:top-0 lg:max-h-dvh lg:w-64 lg:self-start lg:overflow-y-auto lg:py-6 xl:w-72">
      <BannerRail
        banners={banners}
        onOpen={onOpen}
        onDismiss={onDismiss}
        onImpression={onImpression}
      />
    </aside>
  );
}
