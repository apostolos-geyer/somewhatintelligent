/**
 * Product-review server functions (P2.B). Compliance mandates HARD delete — there
 * is NO soft-delete / hide / suppress path anywhere in this file: removal is a
 * real SQL DELETE. Two roles, both gated by `requireUserMiddleware`:
 *
 *  - The budtender owns their OWN review: `upsertMyReview` (one per product via
 *    the UNIQUE(brand_id, product_id, user_id) index → ON CONFLICT updates) and
 *    `deleteMyReview` (real DELETE scoped to `user_id`). `listReviews` is the
 *    gated read (every review on a product in the caller's brand + the average).
 *  - The Brand Admin may DELETE any review (`deleteReview`) — and ONLY delete:
 *    admins never edit or hide. It gates IN-HANDLER on `decideBrandAdmin` and
 *    `writeAudit`s a "review.delete" in the same op.
 *
 * brand_id is ALWAYS the verified envelope's `activeOrgId`, never input — a forged
 * `productId`/`reviewId` from another brand resolves to "not found". The author
 * name is snapshotted from the caller's actor (name → email fallback); the store
 * is the budtender's self-declared snapshot. rating 1..5 + body<=300 are enforced
 * by the arktype edge validator (and the sibling-migration CHECK as defence).
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { products, reviews } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";

/** Cap the reviews list so a hot product never SELECT-*s the whole set; the
 * count/average come from a separate aggregate, so they stay exact. */
const REVIEW_PAGE_SIZE = 100;
/** Cap the admin all-reviews view (defensive bound; cursor paging is a follow-up). */
const ADMIN_REVIEW_PAGE_SIZE = 200;
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";

/** A review as the detail block renders it. `mine` flags the caller's own row. */
export interface ReviewView {
  id: string;
  userId: string;
  authorName: string;
  store: string | null;
  rating: number;
  body: string;
  createdAt: number;
  updatedAt: number;
  /** True iff this is the caller's own review (drives edit/delete affordances). */
  mine: boolean;
}

/** A product's review block: the list, the count, and the average rating. */
export interface ReviewSummary {
  reviews: ReviewView[];
  count: number;
  average: number | null;
  /** The caller's own review, if any (so the composer can pre-fill / replace). */
  mine: ReviewView | null;
}

// Typed review projection as Drizzle returns it (camelCase, schema-mapped).
interface ReviewRow {
  id: string;
  userId: string;
  authorName: string;
  store: string | null;
  rating: number;
  body: string;
  createdAt: number;
  updatedAt: number;
}

function mapView(row: ReviewRow, callerId: string): ReviewView {
  return {
    id: row.id,
    userId: row.userId,
    authorName: row.authorName,
    store: row.store,
    rating: row.rating,
    body: row.body,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    mine: row.userId === callerId,
  };
}

// ─── budtender reads + own-review writes (envelope-scoped) ──────────────────

const productIdInput = type({ productId: "string >= 1" });

/**
 * Gated: every review on a product within the caller's brand, plus the count and
 * average. brand = envelope `activeOrgId`, never input — reviews from another
 * brand's product are unreachable. The caller's own review (if any) is surfaced
 * separately so the composer can pre-fill and replace it in place. Newest first,
 * with the caller's own review pulled to the top.
 */
export const listReviews = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(productIdInput)
  .handler(async ({ data, context }): Promise<ReviewSummary> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const where = and(eq(reviews.brandId, brandId), eq(reviews.productId, data.productId));
    const cols = {
      id: reviews.id,
      userId: reviews.userId,
      authorName: reviews.authorName,
      store: reviews.store,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      updatedAt: reviews.updatedAt,
    };

    // count + average come from an AGGREGATE so they stay correct even though the
    // displayed list is capped (a hot product can have thousands of reviews —
    // never SELECT * the whole set).
    const [agg] = await db
      .select({
        count: sql<number>`count(*)`,
        sum: sql<number>`coalesce(sum(${reviews.rating}), 0)`,
      })
      .from(reviews)
      .where(where);
    const count = agg?.count ?? 0;

    // The caller's own review is fetched explicitly so it's always shown, even if
    // it falls outside the capped first page.
    const mineRow = await db
      .select(cols)
      .from(reviews)
      .where(and(where, eq(reviews.userId, userId)))
      .limit(1);
    const mine = mineRow[0] ? mapView(mineRow[0], userId) : null;

    const page = await db
      .select(cols)
      .from(reviews)
      .where(where)
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(REVIEW_PAGE_SIZE);

    const others = page.map((r) => mapView(r, userId)).filter((r) => !r.mine);
    const ordered = mine ? [mine, ...others] : others;

    return {
      reviews: ordered,
      count,
      average: count > 0 ? (agg?.sum ?? 0) / count : null,
      mine,
    };
  });

const upsertReviewInput = type({
  productId: "string >= 1",
  rating: "1 <= number.integer <= 5",
  "body?": "string <= 300",
  "store?": "string <= 120",
});

/**
 * Gated: create or update the CALLER'S OWN review for a product. The
 * UNIQUE(brand_id, product_id, user_id) index makes this one-per-budtender:
 * `ON CONFLICT` updates the existing row (rating/body/store/author snapshot),
 * preserving `created_at`. The product must be the caller's brand's (the FK +
 * `brand_id` guard); the author name snapshots `actor.name → email → "Budtender"`.
 * Emits a `review_left` event. brand = envelope `activeOrgId`, never input.
 */
export const upsertMyReview = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(upsertReviewInput)
  .handler(async ({ data, context }): Promise<{ ok: true; reviewId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actor = context.principal.actor;
    const userId = actor.id;

    const db = createDb(env.DB);
    // Tenancy: the product must belong to the caller's brand.
    const product = (
      await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, data.productId), eq(products.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!product) throw new Error("not_found");

    const authorName = (actor.name ?? actor.email ?? "Budtender").trim() || "Budtender";
    const store = (data.store ?? "").trim() || null;
    const body = data.body ?? "";
    const now = Date.now();
    const reviewId = ulid();

    // INSERT … ON CONFLICT(unique tuple): a re-review of the same product by the
    // same budtender updates in place (created_at preserved by excluded-omission).
    await db
      .insert(reviews)
      .values({
        id: reviewId,
        brandId,
        productId: data.productId,
        userId,
        authorName,
        store,
        rating: data.rating,
        body,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [reviews.brandId, reviews.productId, reviews.userId],
        set: {
          authorName,
          store,
          rating: data.rating,
          body,
          updatedAt: now,
        },
      });

    await emitEvent({
      brandId,
      actorId: userId,
      type: "review_left",
      targetType: "product",
      targetId: data.productId,
      metadata: { rating: data.rating },
    });

    return { ok: true, reviewId };
  });

/**
 * Gated: the AUTHOR deletes their OWN review (real DELETE — never a soft-delete).
 * Scoped to both `brand_id` and `user_id`, so a budtender can only ever remove
 * their own row; a foreign/forged `productId` is a no-op. brand = envelope
 * `activeOrgId`, never input.
 */
export const deleteMyReview = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(productIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    await db
      .delete(reviews)
      .where(
        and(
          eq(reviews.brandId, brandId),
          eq(reviews.productId, data.productId),
          eq(reviews.userId, userId),
        ),
      );

    return { ok: true };
  });

// ─── admin delete (brand-role gated, DELETE-only — never edit/hide) ─────────

const reviewIdInput = type({ reviewId: "string >= 1" });

/**
 * Admin: HARD-delete any review in the caller's brand. This is the ONLY admin
 * write on reviews — admins delete but NEVER edit or hide (compliance: there is
 * no soft-delete column to flip). The `brand_id` guard scopes the DELETE so an
 * admin can't reach across tenants; a foreign/unknown `reviewId` is a no-op →
 * 404. brand = envelope `activeOrgId`, never input. Brand-Admin gated; audited
 * with the deleted row's identity for accountability.
 */
export const deleteReview = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(reviewIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    // Capture the target identity for the audit before the hard delete.
    const target = (
      await db
        .select({ productId: reviews.productId, userId: reviews.userId })
        .from(reviews)
        .where(and(eq(reviews.id, data.reviewId), eq(reviews.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!target) throw new Error("not_found");

    await db
      .delete(reviews)
      .where(and(eq(reviews.id, data.reviewId), eq(reviews.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "review.delete",
      actorId,
      targetType: "review",
      targetId: data.reviewId,
      meta: { productId: target.productId, authorId: target.userId },
    });

    return { ok: true };
  });

/** A review on the admin moderation list — adds the product name for context. */
export interface AdminReviewView extends ReviewView {
  productId: string;
  productName: string;
}

/**
 * Admin: every review across the caller's brand for the moderation list, joined
 * to its product name, newest first. brand = envelope `activeOrgId`, never input.
 * Brand-role gated so a plain budtender can't enumerate the whole brand's reviews.
 * The admin surface offers DELETE only — no edit/hide affordance exists.
 */
export const listAdminReviews = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminReviewView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const result = await db
      .select({
        id: reviews.id,
        userId: reviews.userId,
        authorName: reviews.authorName,
        store: reviews.store,
        rating: reviews.rating,
        body: reviews.body,
        createdAt: reviews.createdAt,
        updatedAt: reviews.updatedAt,
        productId: reviews.productId,
        productName: products.name,
      })
      .from(reviews)
      .innerJoin(products, eq(products.id, reviews.productId))
      .where(eq(reviews.brandId, brandId))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(ADMIN_REVIEW_PAGE_SIZE);

    return result.map((row) => ({
      ...mapView(row, actorId),
      productId: row.productId,
      productName: row.productName,
    }));
  });
