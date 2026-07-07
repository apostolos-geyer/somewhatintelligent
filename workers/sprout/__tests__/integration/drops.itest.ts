/**
 * Integration probe (real local D1): the Drop-Sheet reads the team's wish-list
 * depends on — the average-rating aggregate the lineup card shows, and the
 * "Appears in" content links. Replays the EXACT queries the server fns
 * (`listLineup`, `listProductContent`) run, so the server↔DB boundary is
 * exercised for real (grouping, brand scoping, the published/not-deleted filters).
 */
import { env } from "cloudflare:test";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { decks, posts, products, reviews } from "@/schema";
import { parseTags } from "@/lib/products";

const db = createDb(env.DB);
const BRAND = "org_drops";
const OTHER = "org_other";

function product(id: string, brandId: string, extra: Partial<typeof products.$inferInsert> = {}) {
  return {
    id,
    brandId,
    category: "Flower",
    name: id,
    status: "published",
    orderIdx: 0,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}

function review(id: string, productId: string, rating: number, brandId = BRAND) {
  return {
    id,
    brandId,
    productId,
    userId: `u_${id}`,
    authorName: "Bud",
    rating,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  await db.delete(reviews);
  await db.delete(posts);
  await db.delete(decks);
  await db.delete(products);
});

describe("listLineup — average rating on the scroll card (real D1 aggregate)", () => {
  it("groups count + avg per product, scoped to the brand", async () => {
    await db.insert(products).values([product("p1", BRAND), product("p2", BRAND)]);
    await db.insert(reviews).values([
      review("r1", "p1", 5),
      review("r2", "p1", 4),
      review("r3", "p1", 3),
      review("r4", "p2", 2),
      // a foreign-brand review on a same-id product must NOT leak into the brand's avg
      review("r5", "p1", 1, OTHER),
    ]);

    const rows = await db
      .select({
        productId: reviews.productId,
        n: count(),
        avg: sql<number>`avg(${reviews.rating})`,
      })
      .from(reviews)
      .where(eq(reviews.brandId, BRAND))
      .groupBy(reviews.productId);

    const byId = new Map(rows.map((r) => [r.productId, r]));
    expect(byId.get("p1")).toMatchObject({ n: 3, avg: 4 }); // (5+4+3)/3, foreign excluded
    expect(byId.get("p2")).toMatchObject({ n: 1, avg: 2 });
  });

  it("a product with no reviews has no aggregate row (card shows no stars)", async () => {
    await db.insert(products).values(product("p_noreviews", BRAND));
    const rows = await db
      .select({ productId: reviews.productId, n: count() })
      .from(reviews)
      .where(eq(reviews.brandId, BRAND))
      .groupBy(reviews.productId);
    expect(rows).toHaveLength(0);
  });

  it("tags_json round-trips through parseTags off a real row", async () => {
    await db
      .insert(products)
      .values(product("p_tags", BRAND, { tagsJson: JSON.stringify(["rotational", "wholesale"]) }));
    const row = (await db.select().from(products).where(eq(products.id, "p_tags"))).at(0)!;
    expect(parseTags(row.tagsJson)).toEqual(["rotational", "wholesale"]);
    expect(row.province).toBeNull();
  });
});

describe("listProductContent — 'Appears in' links (real D1)", () => {
  it("returns the linked PK deck + live posts; excludes deleted/unrelated/foreign", async () => {
    await db.insert(products).values(product("prod", BRAND, { deckId: "deck1" }));
    await db.insert(decks).values([
      {
        id: "deck1",
        brandId: BRAND,
        title: "Garlic PK",
        status: "published",
        pageCount: 1,
        createdAt: 1,
        updatedAt: 1,
      },
      // a draft deck must not surface even if linked
      {
        id: "deck_draft",
        brandId: BRAND,
        title: "Draft",
        status: "draft",
        pageCount: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    await db.insert(posts).values([
      {
        id: "post_live",
        brandId: BRAND,
        authorId: "a",
        caption: "Week 6 flower",
        productId: "prod",
        createdAt: 2,
      },
      {
        id: "post_del",
        brandId: BRAND,
        authorId: "a",
        caption: "old",
        productId: "prod",
        createdAt: 1,
        deletedAt: 9,
      },
      {
        id: "post_other",
        brandId: BRAND,
        authorId: "a",
        caption: "different",
        productId: "nope",
        createdAt: 1,
      },
      {
        id: "post_foreign",
        brandId: OTHER,
        authorId: "a",
        caption: "foreign",
        productId: "prod",
        createdAt: 1,
      },
    ]);

    // deck (forward link) — the exact server-fn query
    const deck = (
      await db
        .select({ id: decks.id, title: decks.title })
        .from(decks)
        .where(
          and(
            eq(decks.id, "deck1"),
            eq(decks.brandId, BRAND),
            eq(decks.status, "published"),
            isNull(decks.archivedAt),
          ),
        )
        .limit(1)
    ).at(0);
    expect(deck).toMatchObject({ id: "deck1", title: "Garlic PK" });

    // posts (reverse link) — newest-first, brand-scoped, not deleted
    const postRows = await db
      .select({ id: posts.id, caption: posts.caption })
      .from(posts)
      .where(and(eq(posts.brandId, BRAND), eq(posts.productId, "prod"), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt));
    expect(postRows.map((p) => p.id)).toEqual(["post_live"]);
  });
});
