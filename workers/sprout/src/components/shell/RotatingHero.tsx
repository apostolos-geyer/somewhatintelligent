import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { BrandLogo } from "@/components/brand/BrandLogo";
import type { BrandRuntime } from "@/lib/brand";

export interface HeroSlide {
  id: string;
  imageUrl: string;
  category?: string | null;
  headline?: string | null;
}

const AUTO_ADVANCE_MS = 6000;

/**
 * RotatingHero — the NEW carousel primitive (none exists in packages/ui). One
 * slide per `hero_slides` row behind the `<BrandLogo>` + tagline + the single
 * "Enter Portal" CTA. Scroll-snap track + arrows + dots + auto-advance (paused on
 * hover/focus, disabled under prefers-reduced-motion). With zero slides it
 * degrades to a brand-color gradient panel (never a broken carousel). It lives in
 * the landing outlet; the persistent banners/AI bubble live in the shell.
 */
export function RotatingHero({
  slides,
  brand,
  tagline,
  onEnter,
}: {
  slides: HeroSlide[];
  brand: BrandRuntime | null;
  /** Hero copy under the wordmark — portal CONTENT config, no longer on the
   * brand runtime (it rides the shell loader's `getPortalContent`). */
  tagline?: string;
  onEnter: () => void;
}) {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const count = slides.length;

  const goTo = useCallback(
    (i: number) => {
      if (count === 0) return;
      const next = ((i % count) + count) % count;
      setActive(next);
      // Scroll the TRACK horizontally to the active slide — never `scrollIntoView`,
      // which walks up and scrolls every scrollable ancestor (incl. the window) to
      // pull the slide into view. Once the page is scrolled past the hero, each
      // auto-advance would yank the window's vertical scroll back up to it.
      // `track.scrollTo({ left })` moves only the track, leaving page scroll alone.
      const track = trackRef.current;
      const child = track?.children[next] as HTMLElement | undefined;
      if (track && child) {
        track.scrollTo({ left: child.offsetLeft, behavior: "smooth" });
      }
    },
    [count],
  );

  useEffect(() => {
    if (count <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!paused.current) goTo(active + 1);
    }, AUTO_ADVANCE_MS);
    return () => window.clearInterval(id);
  }, [active, count, goTo]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label={`${brand?.name ?? "Portal"} highlights`}
      className="relative flex h-full min-h-[60vh] w-full flex-1 items-center justify-center overflow-hidden"
      onMouseEnter={() => (paused.current = true)}
      onMouseLeave={() => (paused.current = false)}
      onFocusCapture={() => (paused.current = true)}
      onBlurCapture={() => (paused.current = false)}
    >
      {/* Background: slides, or a brand-tinted gradient fallback. */}
      {count > 0 ? (
        <div
          ref={trackRef}
          className="absolute inset-0 flex snap-x snap-mandatory overflow-x-hidden"
          aria-live="off"
        >
          {slides.map((slide, i) => (
            <div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`Slide ${i + 1} of ${count}`}
              aria-hidden={i !== active}
              className="relative h-full w-full shrink-0 snap-start"
            >
              <img
                src={slide.imageUrl}
                alt={slide.headline ?? ""}
                className="size-full object-cover"
                loading={i === 0 ? "eager" : "lazy"}
              />
              {slide.category ? (
                <Badge variant="haze-glass" className="absolute top-4 left-4">
                  {slide.category}
                </Badge>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-accent/15" />
      )}

      {/* Scrim for contrast over imagery. */}
      <div className="absolute inset-0 bg-background/40" />

      {/* Overlay: brand mark + tagline + the single CTA. Scales with the viewport
          so the hero reads as a full-bleed brand statement, not a small card. */}
      <div className="relative z-10 flex flex-col items-center gap-5 px-4 text-center sm:gap-6 sm:px-6 lg:gap-8">
        <BrandLogo brand={brand} className="text-4xl sm:text-6xl lg:text-7xl" />
        {tagline ? (
          <p className="max-w-2xl text-base text-foreground/80 text-balance sm:text-xl lg:text-2xl">
            {tagline}
          </p>
        ) : null}
        <Button onClick={onEnter} size="lg" className="px-8 sm:px-10 lg:h-12 lg:px-12 lg:text-base">
          Enter Portal
        </Button>
      </div>

      {/* Arrows + dots (only when there's more than one slide). */}
      {count > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous slide"
            onClick={() => goTo(active - 1)}
            className="absolute top-1/2 left-3 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-foreground shadow-soft-sm"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            onClick={() => goTo(active + 1)}
            className="absolute top-1/2 right-3 z-20 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-card/80 text-foreground shadow-soft-sm"
          >
            <ChevronRight className="size-5" aria-hidden />
          </button>
          <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 gap-2">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === active}
                onClick={() => goTo(i)}
                className={`size-2 rounded-full transition-colors ${
                  i === active ? "bg-primary" : "bg-foreground/30"
                }`}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
