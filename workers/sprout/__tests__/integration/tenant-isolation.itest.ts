/**
 * Integration probe (real local D1 via miniflare): the tenant-isolation refactor
 * (docs/sprout/11-…-fix-plan.md). The refactor makes the *viewed brand* the tenant
 * key — every brand-scoped read/write now scopes by `context.brand.id` (an authorized
 * viewed brand) instead of `context.principal.activeOrgId` (the session's active org).
 *
 * This pool harness binds ONLY D1 — there is NO guestlist RPC and NO request
 * header/cookie context, so the gates themselves (`requireBrandAudience` /
 * `requireBrandAdmin`, which need `getRequestBrandSlug()` headers + `getCallerOrgRole()`
 * guestlist RPC) CANNOT be exercised here. Instead — exactly like brand-flip.itest.ts —
 * we REPLAY the precise D1 reads/writes the post-conversion handlers now run against a
 * real D1, proving the DB shape supports the refactor's invariants:
 *
 *  1. Budtender-on-own-brand regression: a portal-only member (null active org) sees
 *     POPULATED banners/lineup/feed when the read is scoped by brandId — the empty-portal
 *     bug's regression guard — and a brandA-scoped read never returns brandB's rows.
 *  2. By-id forgery is cross-brand-safe: the compound `and(eq(id), eq(brandId))` WHERE
 *     the by-id handlers keep makes a forged foreign-brand id resolve to not-found.
 *  3. ensurePortalMember first-write-wins: `ON CONFLICT (brandId, userId) DO NOTHING`
 *     keeps the FIRST membership, so a budtender who later becomes org staff keeps their
 *     original `budtender`/`request` row.
 */
import { env } from "cloudflare:test";
import { and, asc, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { ensurePortalMember, getPortalRole } from "@/lib/portal-members";
import {
  assets,
  bannerCards,
  bannerDismissals,
  decks,
  portalMembers,
  posts,
  products,
} from "@/schema";

const db = createDb(env.DB);

const BRAND_A = "org_a";
const BRAND_B = "org_b";
const USER_X = "user_x";

function banner(id: string, brandId: string) {
  return {
    id,
    brandId,
    headline: `${id} headline`,
    line: "",
    linkJson: "{}",
    dismissible: 1,
    liveFrom: null, // null = live now
    expiresAt: null, // null = no expiry
    orderIdx: 0,
    createdAt: 1,
  };
}

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

function post(id: string, brandId: string, extra: Partial<typeof posts.$inferInsert> = {}) {
  return {
    id,
    brandId,
    authorId: "author",
    caption: `${id} caption`,
    createdAt: 2,
    ...extra,
  };
}

function deck(id: string, brandId: string) {
  return {
    id,
    brandId,
    title: `${id} title`,
    status: "published",
    pageCount: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function asset(id: string, brandId: string) {
  return {
    id,
    brandId,
    name: `${id} name`,
    type: "pdf",
    fileRef: `ref_${id}`,
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(async () => {
  await db.delete(bannerDismissals);
  await db.delete(bannerCards);
  await db.delete(posts);
  await db.delete(products);
  await db.delete(decks);
  await db.delete(assets);
  await db.delete(portalMembers);
});

// ─── 1 · Budtender-on-own-brand (the plan's #1 regression) ──────────────────
describe("budtender on own brand sees populated, brand-scoped content", () => {
  it("a portal-only member (no org membership) + brandId-scoped reads return seeded rows, brandB excluded", async () => {
    // The budtender: a portal_members row for brandA, NO org membership → their
    // session activeOrgId is null. The old code did `if (!brandId) return []` on
    // that null; the refactor scopes by the viewed brand instead. Seed the audience
    // row exactly as ensurePortalMember writes it (role budtender / source request).
    await db.insert(portalMembers).values({
      id: "pm_a_x",
      brandId: BRAND_A,
      userId: USER_X,
      role: "budtender",
      source: "request",
      createdAt: 1,
    });

    // Populated content on brandA, plus a brandB row of each (the leak guard).
    await db.insert(bannerCards).values([banner("ban_a", BRAND_A), banner("ban_b", BRAND_B)]);
    await db.insert(products).values([product("prod_a", BRAND_A), product("prod_b", BRAND_B)]);
    await db.insert(posts).values([post("post_a", BRAND_A), post("post_b", BRAND_B)]);

    // The audience row exists and confers a portal standing with NO org authority —
    // getPortalRole is the exact read the resolver's audience layer runs.
    expect(await getPortalRole(BRAND_A, USER_X)).toBe("budtender");

    // listActiveBanners — the EXACT post-conversion query: brand-scoped + windowed
    // + LEFT JOIN dismissals, only rows with no dismissal. (userId here is USER_X.)
    const now = Date.now();
    const bannerRows = await db
      .select({ id: bannerCards.id })
      .from(bannerCards)
      .leftJoin(
        bannerDismissals,
        and(eq(bannerDismissals.bannerId, bannerCards.id), eq(bannerDismissals.userId, USER_X)),
      )
      .where(
        and(
          eq(bannerCards.brandId, BRAND_A),
          or(isNull(bannerCards.liveFrom), lte(bannerCards.liveFrom, now)),
          or(isNull(bannerCards.expiresAt), gt(bannerCards.expiresAt, now)),
          isNull(bannerDismissals.bannerId),
        ),
      )
      .orderBy(asc(bannerCards.orderIdx), asc(bannerCards.id));
    // Populated (regression guard) AND brandB's banner is not leaked.
    expect(bannerRows.map((r) => r.id)).toEqual(["ban_a"]);

    // listLineup products — the EXACT post-conversion WHERE (brand + published + not archived).
    const productRows = await db
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          eq(products.brandId, BRAND_A),
          eq(products.status, "published"),
          isNull(products.archivedAt),
        ),
      )
      .orderBy(asc(products.orderIdx), asc(products.name), asc(products.id));
    expect(productRows.map((r) => r.id)).toEqual(["prod_a"]);

    // listFeed posts — the EXACT post-conversion WHERE (brand + not deleted), newest-first.
    const feedRows = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.brandId, BRAND_A), isNull(posts.deletedAt)))
      .orderBy(desc(posts.createdAt), desc(posts.id));
    expect(feedRows.map((r) => r.id)).toEqual(["post_a"]);
  });
});

// ─── 2 · By-id forgery is cross-brand-safe ──────────────────────────────────
describe("by-id reads keep the compound (id AND brandId) WHERE — forged foreign id → not-found", () => {
  it("a brandA row's id, queried under brandB, resolves to no rows (products / decks / assets)", async () => {
    await db.insert(products).values(product("prod_forge", BRAND_A));
    await db.insert(decks).values(deck("deck_forge", BRAND_A));
    await db.insert(assets).values(asset("asset_forge", BRAND_A));

    // products by-id: getProduct keeps `and(eq(products.id, id), eq(products.brandId, brand))`.
    expect(
      await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, "prod_forge"), eq(products.brandId, BRAND_B)))
        .limit(1),
    ).toEqual([]);
    // sanity: the id IS real — only the foreign-brand compound WHERE misses.
    expect(
      (
        await db
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.id, "prod_forge"), eq(products.brandId, BRAND_A)))
          .limit(1)
      ).map((r) => r.id),
    ).toEqual(["prod_forge"]);

    // decks by-id: getDeckReadUrl / loadOwnedDeck keep `and(eq(decks.id, id), eq(decks.brandId, brand))`.
    expect(
      await db
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, "deck_forge"), eq(decks.brandId, BRAND_B)))
        .limit(1),
    ).toEqual([]);
    expect(
      (
        await db
          .select({ id: decks.id })
          .from(decks)
          .where(and(eq(decks.id, "deck_forge"), eq(decks.brandId, BRAND_A)))
          .limit(1)
      ).map((r) => r.id),
    ).toEqual(["deck_forge"]);

    // assets by-id: getAsset*Url / loadOwnedAsset keep `and(eq(assets.id, id), eq(assets.brandId, brand))`.
    expect(
      await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, "asset_forge"), eq(assets.brandId, BRAND_B)))
        .limit(1),
    ).toEqual([]);
    expect(
      (
        await db
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.id, "asset_forge"), eq(assets.brandId, BRAND_A)))
          .limit(1)
      ).map((r) => r.id),
    ).toEqual(["asset_forge"]);
  });
});

// ─── 3 · ensurePortalMember first-write-wins ────────────────────────────────
describe("ensurePortalMember keeps the FIRST membership on conflict", () => {
  it("a budtender who later becomes org staff keeps their original budtender/request row", async () => {
    // First membership: the budtender joins via the request queue.
    await ensurePortalMember({
      brandId: BRAND_A,
      userId: USER_X,
      role: "budtender",
      source: "request",
    });
    // Later lazy org→portal sync tries to write staff/org for the SAME (brandId, userId).
    // The real ensurePortalMember uses onConflictDoNothing on (brandId, userId), so this
    // is a no-op — the first row wins.
    await ensurePortalMember({ brandId: BRAND_A, userId: USER_X, role: "staff", source: "org" });

    // getPortalRole (the resolver's read) still returns the original standing.
    expect(await getPortalRole(BRAND_A, USER_X)).toBe("budtender");

    // And exactly one row survives, with the original role + source (not staff/org).
    const rows = await db
      .select({ role: portalMembers.role, source: portalMembers.source })
      .from(portalMembers)
      .where(and(eq(portalMembers.brandId, BRAND_A), eq(portalMembers.userId, USER_X)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: "budtender", source: "request" });
  });
});
