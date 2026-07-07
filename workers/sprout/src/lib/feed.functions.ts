/**
 * Media-feed server functions (P3.B — "Enter the Grow"). Same §02 tenancy
 * invariant as the rest of the platform: brand_id is NEVER input — it is the
 * verified envelope's `activeOrgId`. A forged `postId`/`commentId` from another
 * brand resolves to "not found", never another brand's row.
 *
 *  - The budtender reads (`listFeed`, `getPost`) gate with `requireUserMiddleware`
 *    and scope every row to `activeOrgId`. `getPost` emits a `post_view` event in
 *    the same read. The cheap list projection renders joinless off denormalized
 *    counters + the `first_comment_json` snapshot + a caller-liked flag.
 *  - The budtender writes (`likePost`, `addComment`, `heartComment`,
 *    `deleteComment`) are gated but not admin-gated — every signed-in budtender
 *    may like, comment, heart, and delete THEIR OWN comment. `brand_team` is
 *    derived SERVER-SIDE from the caller's org role (owner|admin → true), NEVER
 *    from input. After a comment write lands in D1 (the durable log) we
 *    `fanoutToRoom(roomName(brandId, postId), frame)` so every open socket on the
 *    post's live-comment room sees it; the DO holds no persistence.
 *  - The ADMIN writes (`createPost`, `deletePost`) additionally gate IN-HANDLER on
 *    `decideBrandAdmin` + `writeAudit`. createPost: media bytes are R2 blobs
 *    (roadie); the browser registers + finalizes each blob, and createPost stamps
 *    the resulting `media_ref`s into `post_media`. roadie is inert in local dev — a
 *    post with no finalized media still lands (degrades to a caption-only cell).
 *    deletePost: a SOFT-delete (stamps `deleted_at`) of any post in the brand.
 *
 * Counters (`like_count` / `comment_count` / `heart_count`) are denormalized and
 * bumped in the SAME logical write as the row insert/soft-delete. Feed + chat are
 * SOFT-DELETE only (deleted_at): a budtender deletes their OWN comment, a
 * Brand-Admin deletes ANY comment or ANY post — there is no hard-delete of a post
 * or comment. `posts.first_comment_json` is the preview snapshot refreshed on every
 * addComment / deleteComment.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { comments, commentLikes, postLikes, postMedia, posts, products } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin, getCallerOrgRole } from "@/lib/runtime.server";
import { getRoadie } from "@/lib/roadie";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import { fanoutToRoom, roomName } from "@/lib/room";

/** Comment bodies are bounded to 500 chars (arktype + the sibling-migration CHECK). */
const MAX_COMMENT = 500;

/** A media item on a post (image|video R2 blob, ordered). */
export interface PostMediaView {
  id: string;
  mediaRef: string;
  kind: "image" | "video";
  orderIdx: number;
}

/** The first-comment preview snapshot stored on `posts.first_comment_json`. */
export interface FirstCommentPreview {
  authorName: string;
  body: string;
}

/** A post as a feed cell renders it (the cheap, joinless list projection). */
export interface PostCard {
  id: string;
  authorId: string;
  caption: string;
  productId: string | null;
  media: PostMediaView[];
  likeCount: number;
  commentCount: number;
  firstComment: FirstCommentPreview | null;
  /** Derived server-side from the author's org role — drives the Team badge. */
  brandTeam: boolean;
  createdAt: number;
  /** True iff the caller has liked this post (drives the like toggle state). */
  liked: boolean;
}

/** One comment on a post, as the live comment list renders it. */
export interface CommentView {
  id: string;
  postId: string;
  userId: string;
  authorName: string;
  store: string | null;
  body: string;
  brandTeam: boolean;
  heartCount: number;
  createdAt: number;
  /** True iff this is the caller's own comment (drives own-delete affordance). */
  mine: boolean;
  /** True iff the caller has hearted this comment. */
  hearted: boolean;
}

/** A post's full detail — the expanded overlay (carousel + live comments). */
export interface PostDetail extends PostCard {
  comments: CommentView[];
}

// Typed rows come straight off the Drizzle query-builder (camelCase TS keys
// from `schema.ts`). The list/detail projection selects exactly these columns.
type PostRow = {
  id: string;
  authorId: string;
  caption: string;
  productId: string | null;
  likeCount: number;
  commentCount: number;
  firstCommentJson: string | null;
  brandTeam: number;
  createdAt: number;
};

type MediaRow = {
  id: string;
  postId: string;
  mediaRef: string;
  kind: string;
  orderIdx: number;
};

type CommentRow = {
  id: string;
  postId: string;
  userId: string;
  authorName: string;
  store: string | null;
  body: string;
  brandTeam: number;
  heartCount: number;
  createdAt: number;
};

/** The post columns the list/detail projection selects (joinless). */
const postCols = {
  id: posts.id,
  authorId: posts.authorId,
  caption: posts.caption,
  productId: posts.productId,
  likeCount: posts.likeCount,
  commentCount: posts.commentCount,
  firstCommentJson: posts.firstCommentJson,
  brandTeam: posts.brandTeam,
  createdAt: posts.createdAt,
} as const;

/** Safe JSON → first-comment preview. Drops malformed snapshots; never throws. */
function parseFirstComment(json: string | null): FirstCommentPreview | null {
  if (!json) return null;
  try {
    const raw = JSON.parse(json) as unknown;
    if (raw == null || typeof raw !== "object") return null;
    const row = raw as Record<string, unknown>;
    if (typeof row.authorName !== "string" || typeof row.body !== "string") return null;
    return { authorName: row.authorName, body: row.body };
  } catch {
    return null;
  }
}

/** Narrow D1's untyped media `kind` to the closed image|video set (default image). */
function asMediaKind(v: string): "image" | "video" {
  return v === "video" ? "video" : "image";
}

function mapMedia(row: MediaRow): PostMediaView {
  return {
    id: row.id,
    mediaRef: row.mediaRef,
    kind: asMediaKind(row.kind),
    orderIdx: row.orderIdx,
  };
}

function mapCard(row: PostRow, media: PostMediaView[], liked: boolean): PostCard {
  return {
    id: row.id,
    authorId: row.authorId,
    caption: row.caption,
    productId: row.productId,
    media,
    likeCount: row.likeCount,
    commentCount: row.commentCount,
    firstComment: parseFirstComment(row.firstCommentJson),
    brandTeam: row.brandTeam === 1,
    createdAt: row.createdAt,
    liked,
  };
}

function mapComment(row: CommentRow, callerId: string, heartedIds: Set<string>): CommentView {
  return {
    id: row.id,
    postId: row.postId,
    userId: row.userId,
    authorName: row.authorName,
    store: row.store,
    body: row.body,
    brandTeam: row.brandTeam === 1,
    heartCount: row.heartCount,
    createdAt: row.createdAt,
    mine: row.userId === callerId,
    hearted: heartedIds.has(row.id),
  };
}

/** Group ordered media rows by post id (each bucket already order_idx-sorted). */
function groupMedia(rows: MediaRow[]): Map<string, PostMediaView[]> {
  const byPost = new Map<string, PostMediaView[]>();
  for (const row of rows) {
    const item = mapMedia(row);
    const bucket = byPost.get(row.postId);
    if (bucket) bucket.push(item);
    else byPost.set(row.postId, [item]);
  }
  return byPost;
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

/**
 * Gated: the caller's brand's non-deleted posts, newest-first, each with its
 * ordered media, denormalized counters, first-comment preview, the server-derived
 * Team flag, and a `liked` flag for the caller. brand = envelope `activeOrgId`,
 * never input. No active org → empty feed. The media + caller-likes are batched in
 * two extra round-trips keyed on the page of post ids, so a cell renders joinless.
 */
export const listFeed = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<PostCard[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const rows = await db
      .select(postCols)
      .from(posts)
      .where(and(eq(posts.brandId, brandId), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt), desc(posts.id));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [mediaRows, likeRows] = await Promise.all([
      db
        .select({
          id: postMedia.id,
          postId: postMedia.postId,
          mediaRef: postMedia.mediaRef,
          kind: postMedia.kind,
          orderIdx: postMedia.orderIdx,
        })
        .from(postMedia)
        .where(inArray(postMedia.postId, ids))
        .orderBy(asc(postMedia.postId), asc(postMedia.orderIdx)),
      db
        .select({ postId: postLikes.postId })
        .from(postLikes)
        .where(and(eq(postLikes.userId, userId), inArray(postLikes.postId, ids))),
    ]);

    const mediaByPost = groupMedia(mediaRows);
    const likedIds = new Set(likeRows.map((r) => r.postId));
    return rows.map((row) => mapCard(row, mediaByPost.get(row.id) ?? [], likedIds.has(row.id)));
  });

const postIdInput = type({ postId: "string >= 1" });

/**
 * Gated: one post's full detail for the caller's brand — the post + its ordered
 * media + every non-deleted comment (oldest-first, the read order) + the caller's
 * post-like and per-comment-heart flags. Emits a `post_view` event in the same
 * read. The ownership check (`brand_id === activeOrgId`) is the tenancy boundary —
 * a forged/foreign/deleted `postId` resolves to null.
 */
export const getPost = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(postIdInput)
  .handler(async ({ data, context }): Promise<PostDetail | null> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const post = (
      await db
        .select(postCols)
        .from(posts)
        .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)))
        .limit(1)
    ).at(0);
    if (!post) return null;

    const [mediaRows, postLikeRows, commentRows, commentHeartRows] = await Promise.all([
      db
        .select({
          id: postMedia.id,
          postId: postMedia.postId,
          mediaRef: postMedia.mediaRef,
          kind: postMedia.kind,
          orderIdx: postMedia.orderIdx,
        })
        .from(postMedia)
        .where(eq(postMedia.postId, data.postId))
        .orderBy(asc(postMedia.orderIdx)),
      db
        .select({ hit: sql<number>`1` })
        .from(postLikes)
        .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId)))
        .limit(1),
      db
        .select({
          id: comments.id,
          postId: comments.postId,
          userId: comments.userId,
          authorName: comments.authorName,
          store: comments.store,
          body: comments.body,
          brandTeam: comments.brandTeam,
          heartCount: comments.heartCount,
          createdAt: comments.createdAt,
        })
        .from(comments)
        .where(and(eq(comments.postId, data.postId), isNull(comments.deletedAt)))
        .orderBy(asc(comments.createdAt), asc(comments.id)),
      db
        .select({ commentId: commentLikes.commentId })
        .from(commentLikes)
        .innerJoin(comments, eq(comments.id, commentLikes.commentId))
        .where(and(eq(comments.postId, data.postId), eq(commentLikes.userId, userId))),
    ]);

    await emitEvent({
      brandId,
      actorId: userId,
      type: "post_view",
      targetType: "post",
      targetId: post.id,
    });

    const media = mediaRows.map(mapMedia);
    const heartedIds = new Set(commentHeartRows.map((r) => r.commentId));
    const commentViews = commentRows.map((r) => mapComment(r, userId, heartedIds));
    return { ...mapCard(post, media, postLikeRows.at(0) != null), comments: commentViews };
  });

const mediaReadInput = type({ postId: "string >= 1", mediaRef: "string >= 1" });

/**
 * Gated: a short-lived inline read URL for one media blob on a post the caller's
 * brand owns. The tenancy boundary is the join: the `media_ref` must belong to a
 * `post_media` row of a non-deleted post in the caller's brand — a forged
 * postId/mediaRef from another brand resolves to null, never another brand's blob.
 * Returns `{ url: null }` when roadie is inert (local dev, no R2) so the cell
 * degrades to a placeholder rather than a broken frame. brand = envelope
 * `activeOrgId`, never input.
 */
export const getPostMediaReadUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(mediaReadInput)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ mediaRef: postMedia.mediaRef })
        .from(postMedia)
        .innerJoin(posts, eq(posts.id, postMedia.postId))
        .where(
          and(
            eq(postMedia.postId, data.postId),
            eq(postMedia.mediaRef, data.mediaRef),
            eq(posts.brandId, brandId),
            isNull(posts.deletedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (!owned) return { url: null };

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: data.mediaRef,
        disposition: "inline",
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null };
    } catch {
      // roadie inert / failed — the cell degrades to a placeholder.
      return { url: null };
    }
  });

// ─── admin create (brand-role gated, in-handler decideBrandAdmin) ───────────

/**
 * Resolve the caller's server-side Team marker for `brandId`: owner|admin in the
 * brand's BA org. Derived authoritatively from guestlist, NEVER from input — it
 * stamps `posts.brand_team` / `comments.brand_team`.
 */
async function callerIsTeam(brandId: string): Promise<boolean> {
  const role = await getCallerOrgRole(brandId);
  return role === "owner" || role === "admin";
}

const registerMediaInput = type({
  kind: "'image' | 'video'",
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
});

export interface RegisterPostMediaResult {
  /** Reference handle to thread back into `createPost`'s media list. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  upload: { url: string; headers: Record<string, string> } | null;
}

/**
 * Admin: register ONE media blob with roadie ahead of `createPost`. Returns the
 * `referenceId` (threaded back into createPost's media list) + the presigned PUT
 * envelope the browser pushes bytes to. No D1 row lands here — the post + its
 * `post_media` rows are written by `createPost` once every blob is registered +
 * PUT. roadie is inert in local dev: `upload` is null, the admin can't push bytes,
 * and createPost will simply finalize nothing (caption-only post). Brand-Admin
 * gated; brand = envelope `activeOrgId`, never input.
 */
export const registerPostMedia = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(registerMediaInput)
  .handler(async ({ data, context }): Promise<RegisterPostMediaResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const resourceId = ulid();
    let referenceId = `pending:${resourceId}`;
    let upload: RegisterPostMediaResult["upload"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "post_media", resourceId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          upload = {
            url: res.value.upload.uploadUrl,
            headers: res.value.upload.requiredHeaders,
          };
        }
        // "ready" (dedup hit) → no upload needed; "multipart" → out of scope here.
      }
    } catch {
      referenceId = `pending:${resourceId}`; // roadie inert — keep the placeholder
      upload = null;
    }

    return { referenceId, upload };
  });

const createPostInput = type({
  "caption?": "string <= 2200",
  "productId?": "string >= 1",
  media: type({
    referenceId: "string >= 1",
    kind: "'image' | 'video'",
  }).array(),
});

export interface CreatePostResult {
  ok: true;
  postId: string;
  /** How many of the submitted media blobs finalized (roadie inert ⇒ 0). */
  mediaCount: number;
}

/**
 * Admin: publish a feed post. Brand-Admin gated; audited. `brand_team` is derived
 * SERVER-SIDE (owner|admin → 1), never input. Each submitted media item carries a
 * roadie `referenceId` the browser already registered + PUT; we `finalize` each
 * blob and stamp the resulting handle into `post_media` (ordered by submission).
 * roadie is inert in local dev — a blob that won't finalize is SKIPPED, so a post
 * with no finalized media still lands (a caption-only cell). brand = envelope
 * `activeOrgId`, never input.
 */
export const createPost = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(createPostInput)
  .handler(async ({ data, context }): Promise<CreatePostResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);

    // Tenancy: a linked product must belong to the caller's brand.
    const productId = data.productId?.trim() || null;
    if (productId) {
      const owned = (
        await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, productId), eq(products.brandId, brandId)))
          .limit(1)
      ).at(0);
      if (!owned) throw new Error("not_found");
    }

    // brand_team is the verified org role, never input.
    const team = await callerIsTeam(brandId);

    // Finalize each blob; a roadie failure (inert / missing parts) drops that
    // item rather than failing the whole post (degrades to caption-only).
    const finalized: Array<{ ref: string; kind: "image" | "video" }> = [];
    for (const m of data.media) {
      try {
        const res = await getRoadie().finalize({ referenceId: m.referenceId });
        if (res.ok) finalized.push({ ref: res.value.referenceId, kind: m.kind });
      } catch {
        // roadie inert / failed — skip this blob; the post still publishes.
      }
    }

    const postId = ulid();
    const now = Date.now();
    const caption = (data.caption ?? "").trim();

    const postInsert = db.insert(posts).values({
      id: postId,
      brandId,
      authorId: userId,
      caption,
      productId,
      likeCount: 0,
      commentCount: 0,
      firstCommentJson: null,
      brandTeam: team ? 1 : 0,
      createdAt: now,
      deletedAt: null,
    });
    const mediaInserts = finalized.map((m, idx) =>
      db.insert(postMedia).values({
        id: ulid(),
        postId,
        mediaRef: m.ref,
        kind: m.kind,
        orderIdx: idx,
      }),
    );
    await db.batch([postInsert, ...mediaInserts]);

    await writeAudit({
      brandId,
      action: "post.create",
      actorId: userId,
      targetType: "post",
      targetId: postId,
      meta: { mediaCount: finalized.length, productId, brandTeam: team },
    });

    return { ok: true, postId, mediaCount: finalized.length };
  });

/**
 * Admin: SOFT-delete a feed post (stamps `deleted_at` — never a hard delete). The
 * post's `post_media` / `post_likes` / `comments` rows survive as a record but
 * become unreachable, because `listFeed`, `getPost`, and every budtender write
 * already filter `deleted_at IS NULL`. Brand-Admin gated + audited as
 * `post.delete`; there is no author self-delete of a post (unlike comments). A
 * forged/foreign/already-deleted `postId` resolves to "not found", never another
 * brand's row. Fans out a `post.deleted` frame on the post's live-comment room so
 * an open overlay drops to "no longer available". brand = envelope `activeOrgId`,
 * never input.
 */
export const deletePost = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(postIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const post = (
      await db
        .select({ authorId: posts.authorId, productId: posts.productId })
        .from(posts)
        .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)))
        .limit(1)
    ).at(0);
    if (!post) throw new Error("not_found");

    // Brand-Admin only — deleting a post is always the admin path (audited).
    await assertBrandAdmin(brandId, context.principal.actor.role);

    await db
      .update(posts)
      .set({ deletedAt: Date.now() })
      .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)));

    await writeAudit({
      brandId,
      action: "post.delete",
      actorId: userId,
      targetType: "post",
      targetId: data.postId,
      meta: { authorId: post.authorId, productId: post.productId },
    });

    // Live relay so an open post overlay drops to "no longer available".
    await fanoutToRoom(roomName(brandId, data.postId), {
      type: "post.deleted",
      postId: data.postId,
    });

    return { ok: true };
  });

// ─── budtender engagement writes (gated, envelope-scoped) ───────────────────

/**
 * Gated: TOGGLE the caller's like on a post. INSERT OR IGNORE the
 * (post_id,user_id) like + bump `like_count` in the same write; a repeat call
 * removes the like + decrements. brand = envelope `activeOrgId`; the post must be
 * the caller's brand's (a forged/foreign/deleted postId is a no-op). Emits a
 * `post_like` event only on the like (not the un-like). Returns the resulting
 * state so the client can reconcile the optimistic toggle.
 */
export const likePost = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(postIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true; liked: boolean; likeCount: number }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const post = (
      await db
        .select({ likeCount: posts.likeCount })
        .from(posts)
        .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)))
        .limit(1)
    ).at(0);
    if (!post) throw new Error("not_found");

    const existing = (
      await db
        .select({ hit: sql<number>`1` })
        .from(postLikes)
        .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId)))
        .limit(1)
    ).at(0);

    if (existing) {
      // Toggle OFF — drop the like + decrement the denormalized counter.
      await db.batch([
        db
          .delete(postLikes)
          .where(and(eq(postLikes.postId, data.postId), eq(postLikes.userId, userId))),
        db
          .update(posts)
          .set({ likeCount: sql`MAX(0, ${posts.likeCount} - 1)` })
          .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId))),
      ]);
      return { ok: true, liked: false, likeCount: Math.max(0, post.likeCount - 1) };
    }

    // Toggle ON — idempotent insert + bump in the same logical write.
    await db.batch([
      db
        .insert(postLikes)
        .values({ postId: data.postId, userId, createdAt: Date.now() })
        .onConflictDoNothing(),
      db
        .update(posts)
        .set({ likeCount: sql`${posts.likeCount} + 1` })
        .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId))),
    ]);

    await emitEvent({
      brandId,
      actorId: userId,
      type: "post_like",
      targetType: "post",
      targetId: data.postId,
    });

    return { ok: true, liked: true, likeCount: post.likeCount + 1 };
  });

const addCommentInput = type({
  postId: "string >= 1",
  body: `1 <= string <= ${MAX_COMMENT}`,
});

/**
 * Gated: add a comment to a post. INSERTs the comment (`brand_team` derived
 * SERVER-SIDE), bumps `posts.comment_count`, and refreshes `first_comment_json`
 * (the preview snapshot — set only when this is the FIRST comment) in ONE logical
 * write. Author name snapshots `actor.name → email → "Budtender"`. Emits a
 * `comment_create` event, then `fanoutToRoom(roomName(brandId, postId), frame)` so
 * every open socket on the post's live-comment room appends it. brand = envelope
 * `activeOrgId`, never input; the post must be the caller's brand's.
 */
export const addComment = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(addCommentInput)
  .handler(async ({ data, context }): Promise<{ ok: true; comment: CommentView }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actor = context.principal.actor;
    const userId = actor.id;

    const db = createDb(env.DB);
    const post = (
      await db
        .select({ commentCount: posts.commentCount })
        .from(posts)
        .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)))
        .limit(1)
    ).at(0);
    if (!post) throw new Error("not_found");

    const team = await callerIsTeam(brandId);
    const authorName = (actor.name ?? actor.email ?? "Budtender").trim() || "Budtender";
    const body = data.body.trim();
    const now = Date.now();
    const commentId = ulid();

    // The preview snapshot is the FIRST comment only; later comments leave it.
    const isFirst = post.commentCount === 0;
    const firstCommentJson = isFirst ? JSON.stringify({ authorName, body }) : null;

    const commentInsert = db.insert(comments).values({
      id: commentId,
      brandId,
      postId: data.postId,
      userId,
      authorName,
      store: null,
      body,
      brandTeam: team ? 1 : 0,
      heartCount: 0,
      createdAt: now,
      deletedAt: null,
    });
    const postUpdate = isFirst
      ? db
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1`, firstCommentJson })
          .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId)))
      : db
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1` })
          .where(and(eq(posts.id, data.postId), eq(posts.brandId, brandId)));
    await db.batch([commentInsert, postUpdate]);

    await emitEvent({
      brandId,
      actorId: userId,
      type: "comment_create",
      targetType: "post",
      targetId: data.postId,
    });

    // Live relay AFTER the durable write committed (best-effort; never blocks).
    await fanoutToRoom(roomName(brandId, data.postId), {
      type: "comment",
      id: commentId,
      postId: data.postId,
      userId,
      authorName,
      body,
      team,
      heartCount: 0,
      createdAt: now,
    });

    const comment: CommentView = {
      id: commentId,
      postId: data.postId,
      userId,
      authorName,
      store: null,
      body,
      brandTeam: team,
      heartCount: 0,
      createdAt: now,
      mine: true,
      hearted: false,
    };
    return { ok: true, comment };
  });

const commentIdInput = type({ commentId: "string >= 1" });

/**
 * Gated: TOGGLE the caller's heart on a comment. INSERT OR IGNORE the
 * (comment_id,user_id) heart + bump `heart_count` in the same write; a repeat call
 * removes it + decrements. brand = envelope `activeOrgId`; the comment must be the
 * caller's brand's (a forged/foreign/deleted commentId is a no-op). Fans out a
 * `heart.update` frame so every open socket reconciles the live count. Returns the
 * resulting state so the client can reconcile its optimistic toggle.
 */
export const heartComment = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(commentIdInput)
  .handler(
    async ({ data, context }): Promise<{ ok: true; hearted: boolean; heartCount: number }> => {
      const brandId = context.brand.id; // authorized viewed brand, non-null
      const userId = context.principal.actor.id;

      const db = createDb(env.DB);
      const comment = (
        await db
          .select({ postId: comments.postId, heartCount: comments.heartCount })
          .from(comments)
          .where(
            and(
              eq(comments.id, data.commentId),
              eq(comments.brandId, brandId),
              isNull(comments.deletedAt),
            ),
          )
          .limit(1)
      ).at(0);
      if (!comment) throw new Error("not_found");

      const existing = (
        await db
          .select({ hit: sql<number>`1` })
          .from(commentLikes)
          .where(and(eq(commentLikes.commentId, data.commentId), eq(commentLikes.userId, userId)))
          .limit(1)
      ).at(0);

      const hearted = !existing;
      const heartCount = hearted ? comment.heartCount + 1 : Math.max(0, comment.heartCount - 1);

      if (existing) {
        await db.batch([
          db
            .delete(commentLikes)
            .where(
              and(eq(commentLikes.commentId, data.commentId), eq(commentLikes.userId, userId)),
            ),
          db
            .update(comments)
            .set({ heartCount: sql`MAX(0, ${comments.heartCount} - 1)` })
            .where(and(eq(comments.id, data.commentId), eq(comments.brandId, brandId))),
        ]);
      } else {
        await db.batch([
          db
            .insert(commentLikes)
            .values({ commentId: data.commentId, userId, createdAt: Date.now() })
            .onConflictDoNothing(),
          db
            .update(comments)
            .set({ heartCount: sql`${comments.heartCount} + 1` })
            .where(and(eq(comments.id, data.commentId), eq(comments.brandId, brandId))),
        ]);
      }

      // Live relay so every socket on the post's room reconciles the count.
      await fanoutToRoom(roomName(brandId, comment.postId), {
        type: "heart.update",
        commentId: data.commentId,
        postId: comment.postId,
        heartCount,
      });

      return { ok: true, hearted, heartCount };
    },
  );

/**
 * Gated: SOFT-delete a comment (stamps `deleted_at` — never a hard delete). The
 * author may delete their OWN comment; a Brand-Admin may delete ANY comment in the
 * brand (and that admin path writes `writeAudit`). Decrements `posts.comment_count`
 * and refreshes `first_comment_json` from the new oldest surviving comment in the
 * same logical write. Fans out a `comment.deleted` frame so open sockets drop the
 * row live. brand = envelope `activeOrgId`, never input.
 */
export const deleteComment = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(commentIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const comment = (
      await db
        .select({ postId: comments.postId, userId: comments.userId })
        .from(comments)
        .where(
          and(
            eq(comments.id, data.commentId),
            eq(comments.brandId, brandId),
            isNull(comments.deletedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (!comment) throw new Error("not_found");

    // Authorization: own comment, or a Brand-Admin deleting any (audited).
    const isOwn = comment.userId === userId;
    let asAdmin = false;
    if (!isOwn) {
      await assertBrandAdmin(brandId, context.principal.actor.role);
      asAdmin = true;
    }

    const now = Date.now();
    await db.batch([
      db
        .update(comments)
        .set({ deletedAt: now })
        .where(
          and(
            eq(comments.id, data.commentId),
            eq(comments.brandId, brandId),
            isNull(comments.deletedAt),
          ),
        ),
      db
        .update(posts)
        .set({ commentCount: sql`MAX(0, ${posts.commentCount} - 1)` })
        .where(and(eq(posts.id, comment.postId), eq(posts.brandId, brandId))),
    ]);

    // Refresh the preview snapshot from the new oldest surviving comment.
    const next = (
      await db
        .select({ authorName: comments.authorName, body: comments.body })
        .from(comments)
        .where(
          and(
            eq(comments.postId, comment.postId),
            eq(comments.brandId, brandId),
            isNull(comments.deletedAt),
          ),
        )
        .orderBy(asc(comments.createdAt), asc(comments.id))
        .limit(1)
    ).at(0);
    const firstCommentJson = next
      ? JSON.stringify({ authorName: next.authorName, body: next.body })
      : null;
    await db
      .update(posts)
      .set({ firstCommentJson })
      .where(and(eq(posts.id, comment.postId), eq(posts.brandId, brandId)));

    if (asAdmin) {
      await writeAudit({
        brandId,
        action: "comment.delete",
        actorId: userId,
        targetType: "comment",
        targetId: data.commentId,
        meta: { postId: comment.postId, authorId: comment.userId },
      });
    }

    // Live relay so every open socket drops the row.
    await fanoutToRoom(roomName(brandId, comment.postId), {
      type: "comment.deleted",
      commentId: data.commentId,
      postId: comment.postId,
    });

    return { ok: true };
  });
