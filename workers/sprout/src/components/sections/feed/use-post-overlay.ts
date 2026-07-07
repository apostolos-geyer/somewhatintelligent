import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePartySocket } from "partysocket/react";
import {
  deleteComment,
  getPost,
  heartComment,
  likePost,
  type CommentView,
  type PostDetail,
} from "@/lib/feed.functions";
import { getMyOrgRole } from "@/lib/portal.functions";

/** The DO party name for the GROUP_CHAT_ROOM binding (kebab-cased binding). */
const FEED_PARTY = "group-chat-room";

/** The wire frames the GroupChatRoom DO relays for a feed-comment room. */
type FeedFrame =
  | { type: "session.init"; messages: ServerComment[]; online: string[] }
  | ({ type: "comment"; postId: string } & ServerComment)
  | { type: "heart.update"; commentId: string; postId: string; heartCount: number }
  | { type: "comment.deleted"; commentId: string; postId: string }
  | { type: "post.deleted"; postId: string }
  | { type: "presence.joined"; userId: string; displayName: string }
  | { type: "presence.left"; userId: string }
  | { type: "typing"; userId: string; displayName: string };

/** The comment shape the DO sends (session.init history + live `comment` frames). */
interface ServerComment {
  id: string;
  userId: string;
  authorName: string;
  body: string;
  team: boolean;
  heartCount: number;
  createdAt: number;
}

/**
 * Loads the post detail via `getPost` (client-mounted, not a route loader) — seeds
 * the comment list + like state — and owns the optimistic, server-reconciled
 * mutations: post like (toggle + double-tap), comment heart, comment delete.
 */
export function usePostDetail(postId: string) {
  const [post, setPost] = useState<PostDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [comments, setComments] = useState<CommentView[]>([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPost(null);
    setNotFound(false);
    setComments([]);
    void (async () => {
      try {
        const detail = await getPost({ data: { postId } });
        if (cancelled) return;
        if (!detail) {
          setNotFound(true);
          return;
        }
        setPost(detail);
        setComments(detail.comments);
        setLiked(detail.liked);
        setLikeCount(detail.likeCount);
      } catch {
        if (!cancelled) setNotFound(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId]);

  // After a dropped link reconnects, the DO replays `session.init` (its in-memory
  // history may be cold), so we also refetch the durable D1 comment log and merge
  // by id — no row is lost across a reconnect, and none double-renders.
  function refetchHistory() {
    void (async () => {
      try {
        const detail = await getPost({ data: { postId } });
        if (!detail) return;
        setLiked(detail.liked);
        setLikeCount(detail.likeCount);
        setComments((cur) => {
          const have = new Set(cur.map((c) => c.id));
          const fresh = detail.comments.filter((c) => !have.has(c.id));
          return fresh.length ? mergeSorted(cur, fresh) : cur;
        });
      } catch {
        // Best-effort; the socket's own session.init may still seed history.
      }
    })();
  }

  function reconcileLike(rollback: () => void) {
    void (async () => {
      try {
        const res = await likePost({ data: { postId } });
        setLiked(res.liked);
        setLikeCount(res.likeCount);
      } catch {
        rollback();
      }
    })();
  }

  function onToggleLike() {
    if (!post) return;
    // Optimistic toggle, reconciled against the server's authoritative count.
    const nextLiked = !liked;
    setLiked(nextLiked);
    setLikeCount((n) => Math.max(0, n + (nextLiked ? 1 : -1)));
    reconcileLike(() => {
      setLiked(liked);
      setLikeCount(post.likeCount);
    });
  }

  // Double-tap the media → LIKE (never un-like; matches the Instagram gesture).
  // The optimistic bump reconciles against the server; if already liked it's a
  // no-op on the server (idempotent) and we leave the count alone.
  function onDoubleTapLike() {
    if (!post || liked) return;
    setLiked(true);
    setLikeCount((n) => n + 1);
    reconcileLike(() => {
      setLiked(false);
      setLikeCount(post.likeCount);
    });
  }

  function onHeart(comment: CommentView) {
    const nextHearted = !comment.hearted;
    setComments((cur) =>
      cur.map((c) =>
        c.id === comment.id
          ? {
              ...c,
              hearted: nextHearted,
              heartCount: Math.max(0, c.heartCount + (nextHearted ? 1 : -1)),
            }
          : c,
      ),
    );
    void heartComment({ data: { commentId: comment.id } })
      .then((res) => {
        setComments((cur) =>
          cur.map((c) =>
            c.id === comment.id ? { ...c, hearted: res.hearted, heartCount: res.heartCount } : c,
          ),
        );
      })
      .catch(() => {
        // Roll back the optimistic heart.
        setComments((cur) => cur.map((c) => (c.id === comment.id ? comment : c)));
      });
  }

  function onDelete(comment: CommentView) {
    // Optimistic removal (the socket frame also drops it for everyone else).
    setComments((cur) => cur.filter((c) => c.id !== comment.id));
    void deleteComment({ data: { commentId: comment.id } }).catch(() => {
      // Restore on failure (e.g. lost the admin gate race).
      setComments((cur) => mergeSorted(cur, [comment]));
    });
  }

  return {
    post,
    notFound,
    markNotFound: () => setNotFound(true),
    comments,
    setComments,
    liked,
    likeCount,
    refetchHistory,
    onToggleLike,
    onDoubleTapLike,
    onHeart,
    onDelete,
  };
}

/**
 * Subscribes to the post's live-comment room over partysocket (room
 * `brandId:postId`, party `group-chat-room`). Receive + reconcile only — the SEND
 * is the gated `addComment` server fn (NOT over the socket): `session.init` seeds,
 * `comment` appends, `heart.update` patches a count, `comment.deleted` drops a row.
 */
export function useLiveComments({
  postId,
  brandId,
  callerId,
  setComments,
  refetchHistory,
  onPostDeleted,
}: {
  postId: string;
  brandId: string;
  callerId: string;
  setComments: Dispatch<SetStateAction<CommentView[]>>;
  refetchHistory: () => void;
  onPostDeleted: () => void;
}) {
  const [sessionReady, setSessionReady] = useState(false);
  // Newest live comment, surfaced to an aria-live region for screen readers.
  const [liveAnnounce, setLiveAnnounce] = useState("");
  // WS link state — drives the quiet "reconnecting" pill and the on-reconnect
  // history refetch (the DO holds no persistence; D1 `comments` is the log).
  const [connected, setConnected] = useState(false);
  const wasConnected = useRef(false);

  useEffect(() => {
    setSessionReady(false);
    setConnected(false);
    wasConnected.current = false;
  }, [postId]);

  usePartySocket({
    enabled: typeof window !== "undefined",
    host: typeof window !== "undefined" ? window.location.host : "",
    party: FEED_PARTY,
    room: `${brandId}:${postId}`,
    prefix: "ws",
    onOpen: () => {
      setConnected(true);
      // A reconnect (not the first connect): pull the durable history we may
      // have missed while the socket was down.
      if (wasConnected.current) refetchHistory();
      wasConnected.current = true;
    },
    onError: () => {
      setConnected(false);
    },
    onClose: () => {
      setConnected(false);
    },
    onMessage: (e: MessageEvent) => {
      let frame: FeedFrame;
      try {
        frame = JSON.parse(typeof e.data === "string" ? e.data : "") as FeedFrame;
      } catch {
        return;
      }
      applyFrame(frame, {
        postId,
        callerId,
        setComments,
        setSessionReady,
        setLiveAnnounce,
        onPostDeleted,
      });
    },
  });

  return { sessionReady, connected, liveAnnounce };
}

function applyFrame(
  frame: FeedFrame,
  ctx: {
    postId: string;
    callerId: string;
    setComments: Dispatch<SetStateAction<CommentView[]>>;
    setSessionReady: (ready: boolean) => void;
    setLiveAnnounce: (text: string) => void;
    onPostDeleted: () => void;
  },
) {
  switch (frame.type) {
    case "session.init":
      // The durable history seed; merge by id so the getPost load + the
      // socket history don't double-render a comment.
      ctx.setComments((cur) => {
        const have = new Set(cur.map((c) => c.id));
        const seeded = frame.messages
          .filter((m) => !have.has(m.id))
          .map((m) => fromServerComment(m, ctx.postId, ctx.callerId));
        return mergeSorted(cur, seeded);
      });
      ctx.setSessionReady(true);
      break;
    case "comment":
      ctx.setComments((cur) => {
        if (cur.some((c) => c.id === frame.id)) return cur;
        return mergeSorted(cur, [fromServerComment(frame, ctx.postId, ctx.callerId)]);
      });
      // Announce another user's incoming comment to assistive tech (the
      // caller's own send is already visible — don't double-announce it).
      if (frame.userId !== ctx.callerId) {
        ctx.setLiveAnnounce(`New comment from ${frame.authorName}: ${frame.body}`);
      }
      break;
    case "heart.update":
      ctx.setComments((cur) =>
        cur.map((c) => (c.id === frame.commentId ? { ...c, heartCount: frame.heartCount } : c)),
      );
      break;
    case "comment.deleted":
      ctx.setComments((cur) => cur.filter((c) => c.id !== frame.commentId));
      break;
    case "post.deleted":
      // An admin deleted the post out from under an open overlay — drop to the
      // "no longer available" state (mirrors a getPost miss for a deleted post).
      ctx.onPostDeleted();
      break;
    default:
      break;
  }
}

/**
 * Resolves the caller's admin authority for the delete-any affordance. Uses the
 * viewed-brand org role (`getMyOrgRole`, derived from `context.brand.role`
 * server-side) — fetched once per lifetime, mirroring _portal.tsx's owner|admin
 * admin gate.
 */
export function useIsBrandAdmin(brandId: string) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const role = await getMyOrgRole();
        if (!cancelled) setIsAdmin(role === "owner" || role === "admin");
      } catch {
        if (!cancelled) setIsAdmin(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  return isAdmin;
}

/** Map a DO `ServerComment` to a `CommentView` for the local list. */
function fromServerComment(m: ServerComment, postId: string, callerId: string): CommentView {
  return {
    id: m.id,
    postId,
    userId: m.userId,
    authorName: m.authorName,
    store: null,
    body: m.body,
    brandTeam: m.team,
    heartCount: m.heartCount,
    createdAt: m.createdAt,
    mine: m.userId === callerId,
    hearted: false,
  };
}

/** Merge + dedupe two comment lists, sorted oldest-first (createdAt, then id). */
export function mergeSorted(a: CommentView[], b: CommentView[]): CommentView[] {
  const byId = new Map<string, CommentView>();
  for (const c of [...a, ...b]) byId.set(c.id, c);
  return [...byId.values()].sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id));
}
