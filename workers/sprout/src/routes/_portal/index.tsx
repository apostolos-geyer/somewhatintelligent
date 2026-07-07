import { Suspense, useRef } from "react";
import { Await, createFileRoute } from "@tanstack/react-router";
import { RotatingHero, type HeroSlide } from "@/components/shell/RotatingHero";
import { SectionGrid } from "@/components/shell/SectionGrid";
import { DropSheet } from "@/components/drop-sheet/DropSheet";
import { usePortalContent } from "@/components/shell/portal-context";
import { listHeroSlides } from "@/lib/landing.functions";
import { resolveEnabledSections, type BrandRuntime } from "@/lib/brand";
import { isSectionKey, type SectionKey } from "@/lib/sections";

interface PortalSearch {
  section?: SectionKey;
  item?: string;
}

/** Shared content width for the whole portal page — the hero, the section grid,
 *  and the Drop Sheet all sit in a `max-w-6xl` column so they line up edge to
 *  edge instead of the hero running full-bleed while the grid stays narrow. */
const PAGE_WIDTH = "mx-auto w-full max-w-6xl";

/**
 * The brand portal — ONE vertical-scroll page that owns `/` on a brand host.
 * Fold 1 is the rotating hero (brand mark + tagline + the single "Enter Portal"
 * CTA); fold 2, directly below it in the same scroll, is the section grid (Store
 * Assets, PK Decks, Quizzes…) plus the Drop Sheet. "Enter Portal" no longer
 * navigates — it smooth-scrolls down to the section fold, so the whole portal is
 * a single continuous scroll. Sections still open as dialogs via the `?section=`
 * layer (`useLayerStack` → `LayerStack`), which now lives on `/` too; the
 * persistent shell (banners, AI bubble, layer) is mounted around this in
 * `_portal.tsx`.
 *
 * Data shape: the page-shape CONTENT config (tagline / feed label / section
 * toggles) is awaited by the SHELL loader in parallel with banners/roles
 * (`usePortalContent`). Hero slides — the slow read (per-slide roadie URL
 * signing) — are returned as an UNAWAITED promise and streamed into a Suspense
 * boundary, so the hero art pops in without blocking first paint or any soft
 * navigation.
 *
 * Owns the typed `?section=` / `?item=` search schema that drives the layer:
 * `validateSearch` strips any non-canonical section key. With no resolvable hero
 * slides the hero degrades to a brand-tinted gradient; on the apex (brand=null)
 * it shows a neutral Sprout placeholder.
 */
export const Route = createFileRoute("/_portal/")({
  validateSearch: (search: Record<string, unknown>): PortalSearch => ({
    section: isSectionKey(search.section) ? search.section : undefined,
    item: typeof search.item === "string" ? search.item : undefined,
  }),
  // Deliberately NOT awaited — the promise streams into the hero's Suspense
  // boundary below (SSR streams the resolved content into the same response).
  loader: () => ({ slides: listHeroSlides() }),
  component: Landing,
});

function Landing() {
  const { brand } = Route.useRouteContext();
  const { slides } = Route.useLoaderData();
  const content = usePortalContent();
  const sectionsRef = useRef<HTMLDivElement>(null);

  if (!brand) {
    return (
      <section className="mx-auto flex max-w-2xl flex-col items-center gap-3 px-4 py-16 text-center sm:px-6 sm:py-24">
        <h1 className="font-display text-3xl font-bold">Sprout</h1>
        <p className="text-muted-foreground">Pick a portal to get started.</p>
      </section>
    );
  }

  const scrollToSections = () => {
    const el = sectionsRef.current;
    if (!el) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    // Move focus to the section fold so keyboard users land at the next fold,
    // not back at the top of the (now scrolled-past) hero.
    el.focus({ preventScroll: true });
  };

  return (
    <>
      {/* Fold 1 — the hero fills the viewport down to its bottom edge. Only the
          shell header sits above it on this fold (the footer is far below, after
          the grid), so subtract just the header height, not header + footer.
          While the slides promise streams in, the hero renders immediately with
          its gradient fallback (zero slides) — same chrome, no layout shift. */}
      <section className={`${PAGE_WIDTH} flex min-h-[calc(100dvh_-_3rem)] flex-col`}>
        <Suspense
          fallback={
            <HeroFold
              brand={brand}
              tagline={content.tagline}
              slides={[]}
              onEnter={scrollToSections}
            />
          }
        >
          <Await promise={slides}>
            {(resolved) => (
              <HeroFold
                brand={brand}
                tagline={content.tagline}
                slides={resolved}
                onEnter={scrollToSections}
              />
            )}
          </Await>
        </Suspense>
      </section>
      {/* Fold 2 — the section grid + Drop Sheet, same width as the hero above. */}
      <div
        ref={sectionsRef}
        id="portal-sections"
        tabIndex={-1}
        aria-label="Portal sections"
        className={`${PAGE_WIDTH} scroll-mt-4 px-4 py-8 outline-none sm:px-6 md:py-10`}
      >
        <SectionGrid
          sections={resolveEnabledSections(content.sections)}
          feedLabel={content.feedLabel}
        />
        <DropSheet brandKey={brand.orgId} />
      </div>
    </>
  );
}

function HeroFold({
  brand,
  tagline,
  slides,
  onEnter,
}: {
  brand: BrandRuntime;
  tagline: string;
  slides: HeroSlide[];
  onEnter: () => void;
}) {
  return <RotatingHero slides={slides} brand={brand} tagline={tagline} onEnter={onEnter} />;
}
