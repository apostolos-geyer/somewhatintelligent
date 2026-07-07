import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Heart, Loader2, MessageCircle, Package, X } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { type CommentView, type PostDetail } from "@/lib/feed.functions";
import { CommentComposer } from "./CommentComposer";
import { CommentList } from "./CommentList";
import { PostMediaCarousel } from "./PostMediaCarousel";
import { mergeSorted, useIsBrandAdmin, useLiveComments, usePostDetail } from "./use-post-overlay";

/**
 * The expanded post overlay — a full-screen lightbox over the SectionLayer. Loads
 * the post + its comments via `getPost` in a useEffect (client-mounted, not a
 * route loader), then subscribes to the post's live-comment room over partysocket
 * (room `brandId:postId`, party `group-chat-room`). The SEND is the gated
 * `addComment` server fn (NOT over the socket); the socket is receive + reconcile
 * only — `session.init` seeds, `comment` appends, `heart.update` patches a count,
 * `comment.deleted` drops a row. Hearts + the post like are optimistic, reconciled
 * against the server. The author may delete their own comment; a Brand-Admin any.
 * If the post links a product, a button closes the layer then sets `?item=<productId>`
 * on the portal page to deep-link the drop-sheet. Closing restores the feed
 * scroll (the parent passes `onClose`).
 */
export function PostOverlay({
  postId,
  brandId,
  onClose,
}: {
  postId: string;
  brandId: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const callerId = user?.id ?? "";

  const {
    post,
    notFound,
    markNotFound,
    comments,
    setComments,
    liked,
    likeCount,
    refetchHistory,
    onToggleLike,
    onDoubleTapLike,
    onHeart,
    onDelete,
  } = usePostDetail(postId);

  const { sessionReady, connected, liveAnnounce } = useLiveComments({
    postId,
    brandId,
    callerId,
    setComments,
    refetchHistory,
    onPostDeleted: markNotFound,
  });

  const isAdmin = useIsBrandAdmin(brandId);

  // A comment is deletable by its author, or by a Brand-Admin (any comment).
  const canDelete = useMemo(
    () => (comment: CommentView) => comment.userId === callerId || isAdmin,
    [callerId, isAdmin],
  );

  function onOpenProduct() {
    if (!post?.productId) return;
    const productId = post.productId;
    // Close the feed layer, then deep-link the drop-sheet via `?item=`.
    onClose();
    void navigate({
      to: "/",
      search: (s: Record<string, unknown>) => ({
        ...s,
        section: undefined,
        item: productId,
      }),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post"
      className="fixed inset-0 z-[60] flex max-h-dvh flex-col bg-background/95 backdrop-blur-sm"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-bold">Post</h2>
          {post?.brandTeam && <Badge variant="sprout-glass">Team</Badge>}
        </div>
        <button
          type="button"
          aria-label="Close post"
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      {notFound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <AlertTriangle className="size-10" aria-hidden />
          <p className="text-sm">This post is no longer available.</p>
        </div>
      ) : post === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-8 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] overflow-hidden lg:grid-cols-[1fr_24rem] lg:grid-rows-1">
          <PostMediaCarousel
            postId={postId}
            media={post.media}
            caption={post.caption}
            onDoubleTapLike={onDoubleTapLike}
          />

          {/* Caption + actions + live comments + composer. */}
          <div className="flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0">
            <PostActions
              post={post}
              liked={liked}
              likeCount={likeCount}
              commentCount={comments.length}
              onToggleLike={onToggleLike}
              onOpenProduct={onOpenProduct}
            />

            <CommentsPane
              comments={comments}
              canDelete={canDelete}
              onHeart={onHeart}
              onDelete={onDelete}
              liveAnnounce={liveAnnounce}
              sessionReady={sessionReady}
              connected={connected}
            />

            <CommentComposer
              postId={postId}
              callerId={callerId}
              callerName={user?.name ?? null}
              onPosted={(comment) =>
                setComments((cur) =>
                  cur.some((c) => c.id === comment.id) ? cur : mergeSorted(cur, [comment]),
                )
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** The live comment scroll area + the WS-link "reconnecting" pill below it. */
function CommentsPane({
  comments,
  canDelete,
  onHeart,
  onDelete,
  liveAnnounce,
  sessionReady,
  connected,
}: {
  comments: CommentView[];
  canDelete: (comment: CommentView) => boolean;
  onHeart: (comment: CommentView) => void;
  onDelete: (comment: CommentView) => void;
  liveAnnounce: string;
  sessionReady: boolean;
  connected: boolean;
}) {
  const commentEndRef = useRef<HTMLDivElement>(null);
  // Keep the comment list pinned to the newest as comments arrive.
  useEffect(() => {
    commentEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments.length]);

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Rate-limited polite announcer: carries only the single newest
            live comment, so a bulk history merge never floods the AT queue
            (04 §8 a11y — aria-live on the comment list, rate-limited). */}
        <p aria-live="polite" className="sr-only">
          {liveAnnounce}
        </p>
        <CommentList
          comments={comments}
          canDelete={canDelete}
          onHeart={onHeart}
          onDelete={onDelete}
        />
        <div ref={commentEndRef} />
        {!sessionReady && (
          <p className="pt-3 text-center text-xs text-text-tertiary">Connecting…</p>
        )}
      </div>

      {/* A quiet "reconnecting" pill while a previously-live link is down —
          comments still post via the gated server fn and reconcile (history
          refetch) on reconnect. Shown only after the first session seeded so
          it never flickers during the initial connect. */}
      {sessionReady && !connected && (
        <div className="shrink-0 px-4 pb-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-haze/15 px-2.5 py-1 text-xs font-medium text-text-tertiary">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            Reconnecting…
          </span>
        </div>
      )}
    </>
  );
}

/** Caption (when a media frame is showing), like/comment counts, product link. */
function PostActions({
  post,
  liked,
  likeCount,
  commentCount,
  onToggleLike,
  onOpenProduct,
}: {
  post: PostDetail;
  liked: boolean;
  likeCount: number;
  commentCount: number;
  onToggleLike: () => void;
  onOpenProduct: () => void;
}) {
  return (
    <div className="shrink-0 space-y-3 border-b border-border p-4">
      {post.media.length > 0 && post.caption && (
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">{post.caption}</p>
      )}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onToggleLike}
          aria-pressed={liked}
          aria-label={liked ? "Unlike post" : "Like post"}
          className={cn(
            "flex items-center gap-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            liked ? "text-pistil" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Heart className={cn("size-5", liked && "fill-current")} aria-hidden />
          {likeCount}
        </button>
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MessageCircle className="size-5" aria-hidden />
          {commentCount}
        </span>
      </div>
      {post.productId && (
        <Button type="button" variant="outline" size="sm" onClick={onOpenProduct}>
          <Package className="size-4" aria-hidden />
          View Product Details →
        </Button>
      )}
    </div>
  );
}
