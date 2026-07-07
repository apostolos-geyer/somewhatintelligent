import { useEffect, useMemo, useRef, useState } from "react";
import { Sprout } from "lucide-react";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { usePortalContent, usePortalContext } from "@/components/shell/portal-context";
import { useLayerStack } from "@/components/shell/use-layer-stack";
import { listFeed, type PostCard } from "@/lib/feed.functions";
import { FeedCell } from "./FeedCell";
import { PostOverlay } from "./PostOverlay";

/** How many cells render per page; the IntersectionObserver reveals the next page. */
const PAGE_SIZE = 8;

/**
 * The media feed ("Enter the Grow", section 04) — rendered full-screen inside the
 * SectionLayer via the registry, so it takes no props. It reads the active brand
 * from the portal route context and its deep-link target from
 * `useLayerStack().item`: an `?item=<postId>` deep-links straight into the
 * expanded `PostOverlay`.
 *
 * The feed is a private Instagram-style VERTICAL column of `FeedCell` cards
 * (avatar + relative time, media, two caption lines, like + comment counts, and a
 * first-comment preview) loaded via the gated `listFeed` in a useEffect (the
 * section is client-mounted, not a route loader). The full page is fetched once;
 * an IntersectionObserver sentinel reveals it a page at a time so a long feed
 * mounts incrementally instead of all at once. Clicking a cell opens the post
 * overlay (live comments + composer); closing it (`setItem(undefined)`) restores
 * the column scroll, because the column never unmounts while the overlay is open —
 * we keep the scroll container's offset and only swap `?item=`. Loading →
 * Skeleton; empty → "Nothing growing yet."
 */
export function FeedSection() {
  const { brand } = usePortalContext();
  const { feedLabel } = usePortalContent();
  const { item, setItem } = useLayerStack();
  const authorName = brand?.name ?? "Brand";

  const [posts, setPosts] = useState<PostCard[] | null>(null);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Preserve the column scroll offset across an overlay open/close cycle.
  const savedScroll = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setPosts(null);
    setVisible(PAGE_SIZE);
    void (async () => {
      try {
        const rows = await listFeed();
        if (!cancelled) setPosts(rows);
      } catch {
        if (!cancelled) setPosts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand?.orgId]);

  const shown = useMemo(() => posts?.slice(0, visible) ?? [], [posts, visible]);
  const hasMore = posts !== null && visible < posts.length;

  // Reveal the next page when the sentinel scrolls into view (infinite scroll).
  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible((v) => v + PAGE_SIZE);
        }
      },
      { root: scrollRef.current, rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, shown.length]);

  // The deep-linked / opened post id (resolved lazily by the overlay via getPost,
  // so an `?item=` that isn't in the loaded page still opens).
  const openPostId = item ?? null;

  function openPost(postId: string) {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0;
    setItem(postId);
  }

  function closePost() {
    setItem(undefined);
    // Restore the column offset after the overlay unmounts (next frame).
    requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
    });
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (posts === null) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-6 py-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-8 rounded-full" />
              <Skeleton className="h-4 w-28 rounded-sm" />
            </div>
            <Skeleton className="aspect-square w-full rounded-md" />
            <Skeleton className="h-4 w-3/4 rounded-sm" />
            <Skeleton className="h-4 w-1/2 rounded-sm" />
          </div>
        ))}
      </div>
    );
  }

  // ── Empty ────────────────────────────────────────────────────────────────
  if (posts.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
        <Sprout className="size-10 text-muted-foreground" aria-hidden />
        <h3 className="font-display text-lg font-bold">{feedLabel}</h3>
        <p className="text-sm text-muted-foreground">Nothing growing yet.</p>
      </div>
    );
  }

  // ── Vertical feed ──────────────────────────────────────────────────────────
  return (
    <>
      <div ref={scrollRef} className="mx-auto h-full max-w-xl overflow-y-auto">
        {/* `role="feed"` owns the `<article>` cells directly (each FeedCell is an
            article with an accessible name — 04 §8 a11y). */}
        <div role="feed" aria-busy={false} className="flex flex-col gap-6 py-2">
          {shown.map((post) => (
            <FeedCell
              key={post.id}
              post={post}
              authorName={authorName}
              onOpen={() => openPost(post.id)}
            />
          ))}
          {hasMore && <div ref={sentinelRef} aria-hidden className="h-px w-full" />}
        </div>
      </div>

      {openPostId && brand?.orgId && (
        <PostOverlay postId={openPostId} brandId={brand.orgId} onClose={closePost} />
      )}
    </>
  );
}
