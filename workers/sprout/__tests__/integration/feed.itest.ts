/**
 * Integration (idiom-A) — the feed post SOFT-delete the admin `deletePost` server
 * fn performs, exercised against a REAL local D1 in workerd. Replays the EXACT
 * queries the handler runs (the brand-scoped existence probe, the `deleted_at`
 * stamp) so the server↔DB boundary is proven for real:
 *
 *  - soft-delete leaves the row in place (not a hard delete) with `deleted_at` set;
 *  - a soft-deleted post drops out of the `listFeed` projection;
 *  - the post's `post_media` / `post_likes` / `comments` survive (soft-delete does
 *    NOT cascade — the cascade FK fires only on a real row delete);
 *  - the update is brand-scoped, so a caller in another brand can never delete a
 *    post that isn't theirs (INV-14 tenancy).
 */
import { env } from "cloudflare:test";
import { and, desc, eq, isNull } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { commentLikes, comments, postLikes, postMedia, posts } from "@/schema";

const db = createDb(env.DB);
const now = () => Date.now();
const BRAND = "org_feed";
const OTHER = "org_other";

function post(id: string, brandId = BRAND, over: Partial<typeof posts.$inferInsert> = {}) {
  return {
    id,
    brandId,
    authorId: "author_1",
    caption: id,
    likeCount: 0,
    commentCount: 0,
    brandTeam: 1,
    createdAt: now(),
    ...over,
  } satisfies typeof posts.$inferInsert;
}

beforeEach(async () => {
  // Children before parents — the FK cascade would handle it, but be explicit.
  await db.delete(commentLikes);
  await db.delete(comments);
  await db.delete(postLikes);
  await db.delete(postMedia);
  await db.delete(posts);
});

/** Replays `deletePost`'s brand-scoped existence probe (the tenancy boundary). */
function probe(postId: string, brandId: string) {
  return db
    .select({ authorId: posts.authorId, productId: posts.productId })
    .from(posts)
    .where(and(eq(posts.id, postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)))
    .limit(1);
}

/** Replays `deletePost`'s `deleted_at` stamp (brand-scoped, idempotent). */
function softDelete(postId: string, brandId: string) {
  return db
    .update(posts)
    .set({ deletedAt: now() })
    .where(and(eq(posts.id, postId), eq(posts.brandId, brandId), isNull(posts.deletedAt)));
}

/** Replays the `listFeed` projection's row filter (brand + not deleted). */
function listFeedIds(brandId: string) {
  return db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.brandId, brandId), isNull(posts.deletedAt)))
    .orderBy(desc(posts.createdAt), desc(posts.id));
}

describe("deletePost — soft-delete against real D1", () => {
  it("stamps deleted_at without removing the row, and drops it from listFeed", async () => {
    await db.insert(posts).values([post("p_keep"), post("p_del")]);

    expect(await probe("p_del", BRAND)).toHaveLength(1);
    await softDelete("p_del", BRAND);

    // The row survives (soft-delete, not hard) but is now stamped + unreachable.
    const row = (await db.select().from(posts).where(eq(posts.id, "p_del"))).at(0);
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
    expect(await probe("p_del", BRAND)).toHaveLength(0);

    // listFeed shows only the survivor.
    const ids = (await listFeedIds(BRAND)).map((r) => r.id);
    expect(ids).toEqual(["p_keep"]);
  });

  it("does NOT cascade — the post's media, likes, and comments survive the soft-delete", async () => {
    await db.insert(posts).values(post("p_rich"));
    await db
      .insert(postMedia)
      .values({ id: "m1", postId: "p_rich", mediaRef: "ref1", kind: "image", orderIdx: 0 });
    await db.insert(postLikes).values({ postId: "p_rich", userId: "u_liker", createdAt: now() });
    await db.insert(comments).values({
      id: "c1",
      brandId: BRAND,
      postId: "p_rich",
      userId: "u_commenter",
      authorName: "Bud",
      body: "nice",
      brandTeam: 0,
      heartCount: 0,
      createdAt: now(),
    });

    await softDelete("p_rich", BRAND);

    // A real DELETE would cascade these away; a soft-delete must leave them intact.
    expect(await db.select().from(postMedia).where(eq(postMedia.postId, "p_rich"))).toHaveLength(1);
    expect(await db.select().from(postLikes).where(eq(postLikes.postId, "p_rich"))).toHaveLength(1);
    expect(await db.select().from(comments).where(eq(comments.postId, "p_rich"))).toHaveLength(1);
  });

  it("is brand-scoped — another brand can't delete a post that isn't theirs (INV-14)", async () => {
    await db.insert(posts).values(post("p_brand", BRAND));

    // The OTHER brand's probe never sees the post...
    expect(await probe("p_brand", OTHER)).toHaveLength(0);
    // ...and the OTHER-scoped soft-delete leaves it untouched.
    await softDelete("p_brand", OTHER);
    const row = (await db.select().from(posts).where(eq(posts.id, "p_brand"))).at(0);
    expect(row!.deletedAt).toBeNull();
    expect((await listFeedIds(BRAND)).map((r) => r.id)).toEqual(["p_brand"]);
  });

  it("the deleted_at stamp is idempotent — a second delete is a no-op (no row reappears)", async () => {
    await db.insert(posts).values(post("p_twice"));
    await softDelete("p_twice", BRAND);
    const first = (await db.select().from(posts).where(eq(posts.id, "p_twice"))).at(0)!.deletedAt;
    // A repeat delete only matches `deleted_at IS NULL`, so it changes nothing.
    await softDelete("p_twice", BRAND);
    const second = (await db.select().from(posts).where(eq(posts.id, "p_twice"))).at(0)!.deletedAt;
    expect(second).toBe(first);
    expect(await probe("p_twice", BRAND)).toHaveLength(0);
  });
});
