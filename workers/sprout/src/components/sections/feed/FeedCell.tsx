import { useState } from "react";
import { ChevronLeft, ChevronRight, Heart, ImageOff, MessageCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@greenroom/ui/components/avatar";
import { Badge } from "@greenroom/ui/components/badge";
import { VideoPlayer } from "@greenroom/ui/components/video-player";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import type { PostCard, PostMediaView } from "@/lib/feed.functions";
import { usePostMediaUrl } from "@/components/sections/feed/use-post-media";
import { formatWhen, initialsFromName } from "@/lib/format";

/** One media frame inside a feed cell — image or the shared VideoPlayer. */
function CellMedia({
  postId,
  media,
  caption,
}: {
  postId: string;
  media: PostMediaView;
  caption: string;
}) {
  const state = usePostMediaUrl(postId, media.mediaRef);

  if (state.phase === "loading" || state.phase === "unavailable") {
    // Media exists but no signed URL yet (loading) or roadie inert (unavailable) —
    // a neutral tile rather than a broken frame.
    return (
      <div className="flex aspect-square w-full items-center justify-center bg-muted/40 text-muted-foreground">
        <ImageOff className="size-8" aria-hidden />
      </div>
    );
  }
  if (media.kind === "video") {
    return (
      <div className="aspect-square w-full overflow-hidden bg-black">
        <VideoPlayer src={state.url} className="size-full" />
      </div>
    );
  }
  return (
    <img
      src={state.url}
      alt={caption || "Post media"}
      className="aspect-square w-full object-cover"
      loading="lazy"
    />
  );
}

/**
 * One Instagram-style feed cell — a vertical card: author avatar + relative time,
 * the media (single image/video, or a 2–3 image strip with manual dots/arrows), the
 * like + comment counts, two caption lines, and the denormalized first-comment
 * preview (`post.firstComment`, no per-cell join). Tapping the media OR the caption
 * opens the expanded overlay (the parent owns that via `onOpen`). The whole cell is
 * an `<article>` with an accessible name (04 §8 a11y).
 */
export function FeedCell({
  post,
  authorName,
  onOpen,
}: {
  post: PostCard;
  /** The brand display name used for the author identity row. */
  authorName: string;
  onOpen: () => void;
}) {
  const media = post.media;
  const [idx, setIdx] = useState(0);
  const active = media[idx] ?? null;
  const accessibleName = post.caption
    ? `Post by ${authorName}: ${post.caption}`
    : `Post by ${authorName}`;

  return (
    <article aria-label={accessibleName} className={cn(surfaceMaterials.brutal, "overflow-hidden")}>
      {/* Author identity row. */}
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <Avatar size="sm" className="shrink-0">
          <AvatarFallback className="text-[10px] font-semibold text-primary-foreground bg-primary">
            {initialsFromName(authorName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">{authorName}</span>
          {post.brandTeam && (
            <Badge variant="sprout-glass" className="shrink-0 px-1.5 py-0 text-[10px]">
              Team
            </Badge>
          )}
        </div>
        <time className="shrink-0 text-[11px] text-text-tertiary">
          {formatWhen(post.createdAt)}
        </time>
      </header>

      {/* Media (single, video, or 2–3 image strip). Tapping opens the overlay. */}
      {active && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open post"
          className="relative block w-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CellMedia postId={post.id} media={active} caption={post.caption} />
          {media.length > 1 && (
            <>
              {/* Manual strip nav — does not open the overlay (stopPropagation). */}
              {idx > 0 && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Previous media"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIdx((i) => Math.max(0, i - 1));
                  }}
                  className="absolute top-1/2 left-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-soft-sm"
                >
                  <ChevronLeft className="size-4" aria-hidden />
                </span>
              )}
              {idx < media.length - 1 && (
                <span
                  role="button"
                  tabIndex={-1}
                  aria-label="Next media"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIdx((i) => Math.min(media.length - 1, i + 1));
                  }}
                  className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-soft-sm"
                >
                  <ChevronRight className="size-4" aria-hidden />
                </span>
              )}
              <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1.5">
                {media.map((m, i) => (
                  <span
                    key={m.id}
                    className={cn(
                      "size-1.5 rounded-full",
                      i === idx ? "bg-foreground" : "bg-foreground/40",
                    )}
                  />
                ))}
              </span>
            </>
          )}
        </button>
      )}

      {/* Counts + caption + first-comment preview. The text body opens the overlay. */}
      <div className="space-y-1.5 px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-4 text-sm font-medium">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Heart className={cn("size-4", post.liked && "fill-current text-pistil")} aria-hidden />
            {post.likeCount}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <MessageCircle className="size-4" aria-hidden />
            {post.commentCount}
          </span>
        </div>

        {post.caption && (
          <button
            type="button"
            onClick={onOpen}
            className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="line-clamp-2 text-sm text-foreground">{post.caption}</p>
          </button>
        )}

        {post.firstComment && (
          <button
            type="button"
            onClick={onOpen}
            aria-label="View comments"
            className="block w-full text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <p className="line-clamp-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{post.firstComment.authorName}</span>{" "}
              {post.firstComment.body}
            </p>
          </button>
        )}

        {post.commentCount > 1 && (
          <button
            type="button"
            onClick={onOpen}
            className="text-xs text-text-tertiary outline-none hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            View all {post.commentCount} comments
          </button>
        )}
      </div>
    </article>
  );
}
