import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Heart, ImageOff, Loader2 } from "lucide-react";
import { VideoPlayer } from "@greenroom/ui/components/video-player";
import { cn } from "@greenroom/ui/lib/utils";
import type { PostMediaView } from "@/lib/feed.functions";
import { usePostMediaUrl } from "@/components/sections/feed/use-post-media";

/**
 * The overlay's media band — a swipe/chevron-paged carousel (or a caption-only
 * band when the post has no media). Double-tap / double-click fires the parent's
 * like handler plus the decorative heart burst.
 */
export function PostMediaCarousel({
  postId,
  media,
  caption,
  onDoubleTapLike,
}: {
  postId: string;
  media: PostMediaView[];
  caption: string;
  onDoubleTapLike: () => void;
}) {
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [burst, setBurst] = useState(false);
  // Swipe origin + last-tap timestamp for the touch carousel + double-tap-to-like.
  const touchStart = useRef<number | null>(null);
  const lastTap = useRef<number | null>(null);

  const activeMedia = media[carouselIdx] ?? null;

  // Carousel paging, clamped to the loaded media range.
  function goToMedia(next: number) {
    setCarouselIdx(() => {
      const max = media.length - 1;
      if (max < 0) return 0;
      return Math.min(Math.max(0, next), max);
    });
  }

  function fireDoubleTap() {
    setBurst(true);
    window.setTimeout(() => setBurst(false), 600);
    onDoubleTapLike();
  }

  return (
    <div
      role={media.length > 1 ? "group" : undefined}
      aria-roledescription={media.length > 1 ? "carousel" : undefined}
      aria-label={media.length > 1 ? `Post media, ${media.length} items` : undefined}
      className={cn(
        "relative flex min-h-0 touch-pan-y items-center justify-center bg-muted/30 p-4",
        // With media: clip to the carousel frame. Caption-only (no R2 media,
        // or a text post): top-align + scroll so a multi-line caption is never
        // clipped by the band edge (BUG-03).
        media.length > 0 ? "overflow-hidden" : "items-start overflow-y-auto",
      )}
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null;
        const t = e.timeStamp;
        if (lastTap.current && t - lastTap.current < 300) {
          fireDoubleTap();
          lastTap.current = null;
        } else {
          lastTap.current = t;
        }
      }}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (start == null || media.length <= 1) return;
        const dx = (e.changedTouches[0]?.clientX ?? start) - start;
        if (Math.abs(dx) < 40) return;
        goToMedia(carouselIdx + (dx < 0 ? 1 : -1));
      }}
      onDoubleClick={fireDoubleTap}
    >
      {activeMedia ? (
        <MediaFrame postId={postId} media={activeMedia} />
      ) : (
        <p className="max-w-md whitespace-pre-wrap text-center text-base font-medium text-foreground">
          {caption}
        </p>
      )}

      {/* Double-tap heart burst (decorative; the count owns the a11y state). */}
      {burst && (
        <Heart
          aria-hidden
          className="pointer-events-none absolute size-24 animate-ping fill-pistil text-pistil opacity-80"
        />
      )}

      {media.length > 1 && (
        <>
          <CarouselButton
            side="left"
            onClick={() => goToMedia(carouselIdx - 1)}
            disabled={carouselIdx === 0}
          />
          <CarouselButton
            side="right"
            onClick={() => goToMedia(carouselIdx + 1)}
            disabled={carouselIdx === media.length - 1}
          />
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {media.map((m, i) => (
              <button
                key={m.id}
                type="button"
                aria-label={`Go to media ${i + 1}`}
                aria-current={i === carouselIdx}
                onClick={() => goToMedia(i)}
                className={cn(
                  "size-1.5 rounded-full transition-colors",
                  i === carouselIdx ? "bg-foreground" : "bg-foreground/30",
                )}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One media frame in the carousel — image or the shared VideoPlayer. */
function MediaFrame({ postId, media }: { postId: string; media: PostMediaView }) {
  const state = usePostMediaUrl(postId, media.mediaRef);

  if (state.phase === "loading") {
    return <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />;
  }
  if (state.phase === "unavailable") {
    return (
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <ImageOff className="size-10" aria-hidden />
        <p className="text-xs">Media needs R2</p>
      </div>
    );
  }
  if (media.kind === "video") {
    return (
      <div className="w-full max-w-3xl">
        <VideoPlayer src={state.url} />
      </div>
    );
  }
  return (
    <img
      src={state.url}
      alt="Post media"
      className="max-h-full max-w-full rounded-sm object-contain"
    />
  );
}

/** Left/right carousel chevron. */
function CarouselButton({
  side,
  onClick,
  disabled,
}: {
  side: "left" | "right";
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={side === "left" ? "Previous media" : "Next media"}
      className={cn(
        "absolute top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-soft-sm hover:bg-background disabled:opacity-0",
        side === "left" ? "left-3" : "right-3",
      )}
    >
      {side === "left" ? (
        <ChevronLeft className="size-5" aria-hidden />
      ) : (
        <ChevronRight className="size-5" aria-hidden />
      )}
    </button>
  );
}
