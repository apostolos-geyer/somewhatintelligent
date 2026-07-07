/**
 * Drop-Sheet server functions (P2.A) — the product lineup + timed-drop rotations.
 * Same two tenancy modes as the assets library (§02: brand_id is NEVER input):
 *
 *  - The budtender reads (`listLineup`, `getProduct`) gate with
 *    `requireUserMiddleware` and scope every row to the verified envelope's
 *    `activeOrgId`. A forged `productId` from another brand resolves to "not
 *    found", never another brand's SKU. `getProduct` emits a `product_view`
 *    event in the same read.
 *  - The Brand-Admin mutations (`upsertProduct`, `archiveProduct`, `upsertDrop`)
 *    additionally gate IN-HANDLER on `decideBrandAdmin({ actorRole, orgRole })`
 *    (owner|admin in the brand's BA org, or platform admin). Every mutation calls
 *    `writeAudit` in the same logical write.
 *
 * `category` is the closed Flower|Pre-Roll|Infused|Hash|Limited set; the lineup
 * is grouped by it and ordered by `order_idx`. A product carries three authored
 * JSON arrays — terpenes, effects, talking points — parsed at the I/O edge so the
 * client only sees typed arrays. An active drop (window `drops_at..ends_at`)
 * flags the product as a "NEW DROP" on the sheet.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, count, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { decks, drops, posts, products, reviews } from "@/schema";
import {
  CANADIAN_PROVINCES,
  PRODUCT_TAGS,
  PRODUCT_TAG_LABEL,
  isProductTag,
  isProvince,
  parseTags,
  type Province,
  type ProductTag,
} from "@/lib/products";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { nullableTrim } from "@/lib/strings";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";

/** The five Drop-Sheet categories, in the order the sheet groups them. */
export const PRODUCT_CATEGORIES = ["Flower", "Pre-Roll", "Infused", "Hash", "Limited"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export function isProductCategory(v: unknown): v is ProductCategory {
  return typeof v === "string" && (PRODUCT_CATEGORIES as readonly string[]).includes(v);
}

// Cross-cutting product tags + provinces live in the PURE `@/lib/products` leaf
// (node-testable, no `cloudflare:workers`); re-exported here so server + UI keep
// importing them from `drops.functions`.
export { PRODUCT_TAGS, PRODUCT_TAG_LABEL, CANADIAN_PROVINCES, isProductTag, isProvince, parseTags };
export type { ProductTag, Province };

/** Availability badge state on a card. */
export const AVAILABILITY = ["available", "limited", "sold_out", "upcoming"] as const;
export type Availability = (typeof AVAILABILITY)[number];

function asAvailability(v: string): Availability {
  return (AVAILABILITY as readonly string[]).includes(v) ? (v as Availability) : "available";
}

/** A product as a lineup card renders it (the cheap, list-shaped projection). */
export interface ProductCard {
  id: string;
  category: ProductCategory;
  name: string;
  thcPct: number | null;
  cbdPct: number | null;
  format: string | null;
  heroImageRef: string | null;
  availability: Availability;
  availableNote: string | null;
  /** Cross-cutting descriptor tags (rotational|flow-through|wholesale). */
  tags: ProductTag[];
  /** Province code for the provincial-wholesale context, or null. */
  province: string | null;
  /** Review summary — surfaced on the card now (avg rating on scroll), not just
   *  the detail. `averageRating` is null when there are no reviews yet. */
  reviewCount: number;
  averageRating: number | null;
  /** True when an active drop window currently surfaces this product. */
  isNewDrop: boolean;
}

/** A product detail — the full sheet (right Sheet / bottom Drawer). */
export interface ProductDetail extends ProductCard {
  cbd: number | null;
  terpenes: string[];
  effects: string[];
  talkingPoints: string[];
  batch: string | null;
  /** Provincial wholesale listing link (OCS/SQDC/etc.), or null. */
  wholesaleUrl: string | null;
  /** Non-null ⇒ a "Full PK →" jump into the decks layer. */
  deckId: string | null;
}

/** A lineup category group as the sheet renders one horizontal strip. */
export interface LineupGroup {
  category: ProductCategory;
  products: ProductCard[];
}

/** The admin lineup projection — adds lifecycle fields the budtender never sees. */
export interface AdminProductView {
  id: string;
  category: ProductCategory;
  name: string;
  thcPct: number | null;
  cbdPct: number | null;
  terpenes: string[];
  effects: string[];
  talkingPoints: string[];
  format: string | null;
  batch: string | null;
  availability: Availability;
  availableNote: string | null;
  tags: ProductTag[];
  wholesaleUrl: string | null;
  province: string | null;
  deckId: string | null;
  status: string;
  orderIdx: number;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// Typed product row as Drizzle returns it (camelCase, schema-mapped).
type ProductRow = typeof products.$inferSelect;

/** Safe JSON → string[]. Drops non-strings; never throws. */
function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function asCategory(v: string): ProductCategory {
  return isProductCategory(v) ? v : "Flower";
}

/** A product's review rollup (count + average), or zero/null when none. */
interface ReviewSummary {
  n: number;
  avg: number | null;
}

function mapCard(row: ProductRow, isNewDrop: boolean, summary?: ReviewSummary): ProductCard {
  return {
    id: row.id,
    category: asCategory(row.category),
    name: row.name,
    thcPct: row.thcPct,
    cbdPct: row.cbdPct,
    format: row.format,
    heroImageRef: row.heroImageRef,
    availability: asAvailability(row.availability),
    availableNote: row.availableNote,
    tags: parseTags(row.tagsJson),
    province: row.province,
    reviewCount: summary?.n ?? 0,
    averageRating: summary?.avg ?? null,
    isNewDrop,
  };
}

function mapAdminView(row: ProductRow): AdminProductView {
  return {
    id: row.id,
    category: asCategory(row.category),
    name: row.name,
    thcPct: row.thcPct,
    cbdPct: row.cbdPct,
    terpenes: parseStringArray(row.terpenesJson),
    effects: parseStringArray(row.effectsJson),
    talkingPoints: parseStringArray(row.talkingPointsJson),
    format: row.format,
    batch: row.batch,
    availability: asAvailability(row.availability),
    availableNote: row.availableNote,
    tags: parseTags(row.tagsJson),
    wholesaleUrl: row.wholesaleUrl,
    province: row.province,
    deckId: row.deckId,
    status: row.status,
    orderIdx: row.orderIdx,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

/**
 * Gated: the caller's brand's published, non-archived products grouped by the
 * canonical category set, each group ordered by `order_idx` then name. An active
 * drop (a `drops` row whose `[drops_at, ends_at]` window contains now) flags its
 * product as a "NEW DROP". brand = envelope `activeOrgId`, never input. No active
 * org → empty list (the sheet renders nothing).
 *
 * Only categories that actually have products are returned, in canonical order,
 * so the sheet never renders an empty strip.
 */
export const listLineup = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<LineupGroup[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const now = Date.now();
    const [productRows, dropRows, reviewRows] = await Promise.all([
      db
        .select()
        .from(products)
        .where(
          and(
            eq(products.brandId, brandId),
            eq(products.status, "published"),
            isNull(products.archivedAt),
          ),
        )
        .orderBy(asc(products.orderIdx), asc(products.name), asc(products.id)),
      db
        .selectDistinct({ productId: drops.productId })
        .from(drops)
        .where(
          and(
            eq(drops.brandId, brandId),
            lte(drops.dropsAt, now),
            or(isNull(drops.endsAt), gte(drops.endsAt, now)),
          ),
        ),
      // One grouped aggregate for the whole brand → the avg rating + count each
      // card shows on the scroll (no per-card N+1).
      db
        .select({
          productId: reviews.productId,
          n: count(),
          avg: sql<number | null>`avg(${reviews.rating})`,
        })
        .from(reviews)
        .where(eq(reviews.brandId, brandId))
        .groupBy(reviews.productId),
    ]);

    const active = new Set(dropRows.map((d) => d.productId));
    const summaries = new Map<string, ReviewSummary>(
      reviewRows.map((r) => [r.productId, { n: r.n, avg: r.avg }]),
    );

    // Bucket into canonical category order; only emit non-empty groups.
    const byCategory = new Map<ProductCategory, ProductCard[]>();
    for (const row of productRows) {
      const card = mapCard(row, active.has(row.id), summaries.get(row.id));
      const bucket = byCategory.get(card.category);
      if (bucket) bucket.push(card);
      else byCategory.set(card.category, [card]);
    }
    return PRODUCT_CATEGORIES.filter((c) => byCategory.has(c)).map((category) => ({
      category,
      products: byCategory.get(category)!,
    }));
  });

const productIdInput = type({ productId: "string >= 1" });

/**
 * Gated: one published product's full detail for the caller's brand, plus its
 * review summary (count + average). The ownership check (`brand_id ===
 * activeOrgId`) is the tenancy boundary — a forged `productId` from another brand
 * resolves to null. Emits a `product_view` event in the same read (the engagement
 * signal the dashboards count). A draft/archived/foreign product → null.
 */
export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(productIdInput)
  .handler(async ({ data, context }): Promise<ProductDetail | null> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const now = Date.now();
    const [rowResult, dropResult, summaryResult] = await Promise.all([
      db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, data.productId),
            eq(products.brandId, brandId),
            eq(products.status, "published"),
            isNull(products.archivedAt),
          ),
        )
        .limit(1),
      db
        .select({ hit: sql<number>`1` })
        .from(drops)
        .where(
          and(
            eq(drops.brandId, brandId),
            eq(drops.productId, data.productId),
            lte(drops.dropsAt, now),
            or(isNull(drops.endsAt), gte(drops.endsAt, now)),
          ),
        )
        .limit(1),
      db
        .select({ n: count(), avg: sql<number | null>`avg(${reviews.rating})` })
        .from(reviews)
        .where(and(eq(reviews.brandId, brandId), eq(reviews.productId, data.productId))),
    ]);
    const row = rowResult.at(0);
    const drop = dropResult.at(0) ?? null;
    const summary = summaryResult.at(0);
    if (!row) return null;

    await emitEvent({
      brandId,
      actorId: userId,
      type: "product_view",
      targetType: "product",
      targetId: row.id,
      metadata: { category: row.category },
    });

    const card = mapCard(row, drop != null, {
      n: summary?.n ?? 0,
      avg: summary?.avg ?? null,
    });
    return {
      ...card,
      cbd: row.cbdPct,
      terpenes: parseStringArray(row.terpenesJson),
      effects: parseStringArray(row.effectsJson),
      talkingPoints: parseStringArray(row.talkingPointsJson),
      batch: row.batch,
      wholesaleUrl: row.wholesaleUrl,
      deckId: row.deckId,
    };
  });

/** One piece of content a product appears in (a linked PK deck or a feed post). */
export interface ProductContentLink {
  type: "deck" | "post";
  id: string;
  title: string;
}

const POST_LINK_LIMIT = 12;

/** Truncate a caption for a content-link label. */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Gated: the content the caller's-brand product is featured in — its linked PK
 * deck (the forward `deck_id`) plus the feed posts that reference it (reverse
 * `posts.product_id`). Brand-scoped: a product that isn't the caller's brand's (or
 * isn't published) resolves to an empty list, never a cross-brand peek. Posts are
 * newest-first, capped. The "Links to content the product is included in" ask.
 */
export const listProductContent = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(productIdInput)
  .handler(async ({ data, context }): Promise<ProductContentLink[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ deckId: products.deckId })
        .from(products)
        .where(
          and(
            eq(products.id, data.productId),
            eq(products.brandId, brandId),
            eq(products.status, "published"),
            isNull(products.archivedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (!owned) return [];

    const out: ProductContentLink[] = [];

    // The linked PK deck (forward link), only if published + live.
    if (owned.deckId) {
      const deck = (
        await db
          .select({ id: decks.id, title: decks.title })
          .from(decks)
          .where(
            and(
              eq(decks.id, owned.deckId),
              eq(decks.brandId, brandId),
              eq(decks.status, "published"),
              isNull(decks.archivedAt),
            ),
          )
          .limit(1)
      ).at(0);
      if (deck) out.push({ type: "deck", id: deck.id, title: deck.title });
    }

    // Feed posts that tag this product (reverse link), newest-first, capped.
    const postRows = await db
      .select({ id: posts.id, caption: posts.caption, createdAt: posts.createdAt })
      .from(posts)
      .where(
        and(
          eq(posts.brandId, brandId),
          eq(posts.productId, data.productId),
          isNull(posts.deletedAt),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(POST_LINK_LIMIT);
    for (const p of postRows) {
      out.push({
        type: "post",
        id: p.id,
        title: p.caption.trim() ? truncate(p.caption.trim(), 60) : "Feed post",
      });
    }

    return out;
  });

/**
 * Admin: the full lineup (incl. drafts + archived) for the management table.
 * brand = envelope `activeOrgId`, never input. Brand-role gated so a plain
 * budtender can't enumerate drafts. Ordered by category then `order_idx`.
 */
export const listAdminProducts = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminProductView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(products)
      .where(eq(products.brandId, brandId))
      .orderBy(
        asc(products.category),
        asc(products.orderIdx),
        asc(products.name),
        asc(products.id),
      );

    return rows.map(mapAdminView);
  });

// ─── admin mutations (brand-role gated, in-handler decideBrandAdmin) ────────

const upsertProductInput = type({
  "productId?": "string >= 1",
  category: "'Flower' | 'Pre-Roll' | 'Infused' | 'Hash' | 'Limited'",
  name: "string >= 1",
  "thcPct?": "number >= 0",
  "cbdPct?": "number >= 0",
  terpenes: "string[]",
  effects: "string[]",
  talkingPoints: "string[]",
  "format?": "string",
  "batch?": "string",
  "heroImageRef?": "string",
  availability: "'available' | 'limited' | 'sold_out' | 'upcoming'",
  "availableNote?": "string",
  "tags?": "string[]",
  "wholesaleUrl?": "string",
  "province?": "string",
  "deckId?": "string",
  status: "'draft' | 'published'",
  "orderIdx?": "number >= 0",
});

/**
 * Admin: create or edit a product. Without `productId` it INSERTs a new row;
 * with one it UPDATEs the caller's brand's product (the `brand_id` guard makes a
 * cross-brand edit a no-op → 404). The three authored arrays are stored as JSON;
 * empty optional strings clear their column. brand = envelope `activeOrgId`,
 * never input. Brand-Admin gated; audited.
 */
export const upsertProduct = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertProductInput)
  .handler(async ({ data, context }): Promise<{ ok: true; productId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const now = Date.now();
    const terpenesJson = JSON.stringify(data.terpenes);
    const effectsJson = JSON.stringify(data.effects);
    const talkingPointsJson = JSON.stringify(data.talkingPoints);
    const format = nullableTrim(data.format);
    const batch = nullableTrim(data.batch);
    const heroImageRef = nullableTrim(data.heroImageRef);
    const availableNote = nullableTrim(data.availableNote);
    const deckId = nullableTrim(data.deckId);
    // Keep only known tags (drop garbage/dups); normalise the province to its
    // upper-case 2-letter code, dropping anything not in the Canadian set.
    const tagsJson = JSON.stringify([...new Set((data.tags ?? []).filter(isProductTag))]);
    const wholesaleUrl = nullableTrim(data.wholesaleUrl);
    const provinceRaw = nullableTrim(data.province)?.toUpperCase();
    const province = provinceRaw && isProvince(provinceRaw) ? provinceRaw : null;

    if (data.productId) {
      const updated = await db
        .update(products)
        .set({
          category: data.category,
          name: data.name,
          thcPct: data.thcPct ?? null,
          cbdPct: data.cbdPct ?? null,
          terpenesJson,
          effectsJson,
          talkingPointsJson,
          format,
          batch,
          heroImageRef,
          availability: data.availability,
          availableNote,
          tagsJson,
          wholesaleUrl,
          province,
          deckId,
          status: data.status,
          orderIdx: data.orderIdx ?? 0,
          updatedAt: now,
        })
        .where(and(eq(products.id, data.productId), eq(products.brandId, brandId)))
        .returning({ id: products.id });
      if (updated.length === 0) throw new Error("not_found");

      await writeAudit({
        brandId,
        action: "product.upsert",
        actorId: userId,
        targetType: "product",
        targetId: data.productId,
        meta: { name: data.name, category: data.category, status: data.status },
      });
      return { ok: true, productId: data.productId };
    }

    const productId = ulid();
    await db.insert(products).values({
      id: productId,
      brandId,
      category: data.category,
      name: data.name,
      thcPct: data.thcPct ?? null,
      cbdPct: data.cbdPct ?? null,
      terpenesJson,
      effectsJson,
      talkingPointsJson,
      format,
      batch,
      heroImageRef,
      availability: data.availability,
      availableNote,
      tagsJson,
      wholesaleUrl,
      province,
      deckId,
      status: data.status,
      orderIdx: data.orderIdx ?? 0,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      brandId,
      action: "product.upsert",
      actorId: userId,
      targetType: "product",
      targetId: productId,
      meta: { name: data.name, category: data.category, status: data.status },
    });
    return { ok: true, productId };
  });

/**
 * Admin: archive a product (soft delete — stamps `archived_at`). It drops out of
 * `listLineup` immediately but its reviews + analytics history survive. brand =
 * envelope `activeOrgId`; the UPDATE's `brand_id` guard scopes the write.
 */
export const archiveProduct = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(productIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const archived = await db
      .update(products)
      .set({ archivedAt: Date.now(), updatedAt: Date.now() })
      .where(
        and(
          eq(products.id, data.productId),
          eq(products.brandId, brandId),
          isNull(products.archivedAt),
        ),
      )
      .returning({ id: products.id });
    if (archived.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "product.archive",
      actorId: userId,
      targetType: "product",
      targetId: data.productId,
    });

    return { ok: true };
  });

const upsertDropInput = type({
  productId: "string >= 1",
  "headline?": "string",
  dropsAt: "number >= 0",
  "endsAt?": "number >= 0",
  isLimited: "boolean",
});

/**
 * Admin: open a timed drop / limited release surfacing a product first. INSERTs a
 * `drops` row (re-releasable — each call appends a new window) after verifying the
 * product is the caller's brand's. While the `[dropsAt, endsAt]` window is live,
 * `listLineup`/`getProduct` flag the product as a "NEW DROP". brand = envelope
 * `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const upsertDrop = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertDropInput)
  .handler(async ({ data, context }): Promise<{ ok: true; dropId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, data.productId), eq(products.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    const dropId = ulid();
    await db.insert(drops).values({
      id: dropId,
      brandId,
      productId: data.productId,
      headline: nullableTrim(data.headline),
      dropsAt: data.dropsAt,
      endsAt: data.endsAt ?? null,
      isLimited: data.isLimited ? 1 : 0,
      createdAt: Date.now(),
    });

    await writeAudit({
      brandId,
      action: "drop.upsert",
      actorId: userId,
      targetType: "drop",
      targetId: dropId,
      meta: { productId: data.productId, dropsAt: data.dropsAt, endsAt: data.endsAt ?? null },
    });

    return { ok: true, dropId };
  });
