// Pure catalog helpers, extracted from products.functions.ts so the slug/SKU/
// size-ordering + cover/stock-rollup rules are unit-testable without the
// server-fn + D1 wrapper (behavior-identical extraction).
//
// The `StoreCatalog` read layer (RFC-0001 "StoreCatalog RPC" / D3, D4) also
// lives here: the release-model queries that build the public `ProductCardDTO`/
// `ProductDetailDTO` from the ACTIVE immutable release + live variant stock, plus
// the INV-MEDIA-1 eligibility gate for `openProductMedia`. The functions take a
// `Db` and (for media) an injectable `MediaStorage` port so the whole read path
// is exercised against a real D1 with a stubbed storage port in the pool suite.
import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { err, ok } from "@si/contracts/result";
import type {
  DomainResult,
  ProductCardDTO,
  ProductDetailDTO,
  ProductVariantDTO,
  PublicMediaRef,
} from "@si/contracts";
import { SIZE_ORDER } from "@/lib/config";
import type { Db } from "@/lib/db";
import type { MediaStorage } from "@/lib/media-storage";
import {
  productBase,
  productImage,
  productRelease,
  productReleaseImage,
  productVariant,
} from "@/db/schema";

const SIZE_RANK = new Map(SIZE_ORDER.map((s, i) => [s as string, i]));

/** URL-safe slug: lowercase, non-alnum → "-", trimmed, ≤64 chars. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Default SKU when the admin leaves it blank: `<slug>-<size>` upper-cased,
 *  stripped to A–Z/0–9/dash. */
export function skuFor(slug: string, size: string): string {
  return `${slug}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/** Order variant rows by the canonical size order (unknown sizes sort last). */
export function sortBySize<T extends { size: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (SIZE_RANK.get(a.size) ?? 999) - (SIZE_RANK.get(b.size) ?? 999));
}

/** Per-product cover-image ref (first UPLOADED image by position) + summed stock. */
export function buildProductMaps(
  images: {
    productId: string;
    roadieReferenceId: string;
    position: number;
    uploadedAt: Date | null;
  }[],
  variants: { productId: string; stock: number }[],
): { cover: Map<string, string>; stock: Map<string, number> } {
  const cover = new Map<string, string>();
  for (const img of [...images].sort((a, b) => a.position - b.position)) {
    if (img.uploadedAt && !cover.has(img.productId)) {
      cover.set(img.productId, img.roadieReferenceId);
    }
  }
  const stock = new Map<string, number>();
  for (const v of variants) {
    stock.set(v.productId, (stock.get(v.productId) ?? 0) + v.stock);
  }
  return { cover, stock };
}

// ── StoreCatalog read layer (RFC-0001 "StoreCatalog RPC") ────────────────────

/** All Store money is CAD (RFC-0001 "StoreCatalog RPC" — `currency: "CAD"`). */
const CURRENCY = "CAD" as const;
/** Default / clamp bounds for `listProducts` page size. */
export const DEFAULT_PAGE_LIMIT = 24;
export const MAX_PAGE_LIMIT = 100;

type Availability = ProductCardDTO["availability"];

/** The storage-neutral public URL for a domain media id (the `/api/store` HTTP
 *  surface lands in T12; this stable path is the PublicMediaRef contract). */
export function mediaHref(mediaId: string): string {
  return `/api/store/media/${mediaId}`;
}

/** Collapse a description's whitespace and truncate to a card excerpt; null when
 *  the release has no description (never derived from draft copy). */
export function excerpt(markdown: string | null, maxLen = 200): string | null {
  if (markdown === null) return null;
  const flat = markdown.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return null;
  return flat.length <= maxLen ? flat : `${flat.slice(0, maxLen - 1).trimEnd()}…`;
}

/** Availability from CURRENT variant stock (never from release data): no variant
 *  → 'unavailable'; variants but zero total stock → 'sold_out'; else 'available'. */
function availabilityOf(variantCount: number, totalStock: number): Availability {
  if (variantCount === 0) return "unavailable";
  return totalStock > 0 ? "available" : "sold_out";
}

/** Availability helper over a variant list (unit-testable form of `availabilityOf`). */
export function availabilityFor(variants: readonly { stock: number }[]): Availability {
  const total = variants.reduce((sum, v) => sum + v.stock, 0);
  return availabilityOf(variants.length, total);
}

/** Cover = the release image with role 'cover' if present, else the first by
 *  position. Input is expected ordered by position ascending. */
function pickCoverMediaId(media: readonly PublicMediaRef[]): string | null {
  if (media.length === 0) return null;
  const cover = media.find((m) => m.role === "cover");
  return (cover ?? media[0]!).id;
}

/** Opaque keyset cursor over (updatedAt ms, id). Base64url of `${updatedAt}:${id}`. */
export function encodeCursor(row: { updatedAt: number; id: string }): string {
  return btoa(`${row.updatedAt}:${row.id}`)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a keyset cursor; null (not throw) for anything malformed → invalid_cursor. */
export function decodeCursor(raw: string): { updatedAt: number; id: string } | null {
  try {
    const decoded = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const sep = decoded.indexOf(":");
    if (sep < 0) return null;
    const head = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    // updatedAt is a non-negative epoch-ms integer; reject empty/non-digit heads
    // (Number("") coerces to 0) and empty ids.
    if (!/^\d+$/.test(head) || id.length === 0) return null;
    const updatedAt = Number(head);
    if (!Number.isSafeInteger(updatedAt)) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.trunc(limit)));
}

/** PublicMediaRefs frozen into a release: the snapshot alt/role/position joined to
 *  the live image's immutable content facts, only 'ready' images, position order. */
async function loadReleaseMedia(db: Db, releaseId: string): Promise<PublicMediaRef[]> {
  const rows = await db
    .select({
      id: productImage.id,
      contentType: productImage.contentType,
      width: productImage.width,
      height: productImage.height,
      alt: productReleaseImage.alt,
      role: productReleaseImage.role,
      position: productReleaseImage.position,
    })
    .from(productReleaseImage)
    .innerJoin(productImage, eq(productImage.id, productReleaseImage.imageId))
    .where(and(eq(productReleaseImage.releaseId, releaseId), eq(productImage.state, "ready")))
    .orderBy(asc(productReleaseImage.position));
  return rows.map((r) => ({
    id: r.id,
    href: mediaHref(r.id),
    alt: r.alt,
    role: r.role,
    position: r.position,
    contentType: r.contentType,
    width: r.width,
    height: r.height,
  }));
}

// The active-release fields shared by card + detail (title/price/version/copy
// come from the immutable release, never the mutable draft).
interface ActiveRow {
  id: string;
  slug: string;
  releaseId: string;
  version: string;
  title: string;
  descriptionMarkdown: string | null;
  priceCents: number;
}

async function buildDetail(db: Db, row: ActiveRow): Promise<ProductDetailDTO> {
  const [media, variantRows] = await Promise.all([
    loadReleaseMedia(db, row.releaseId),
    db.select().from(productVariant).where(eq(productVariant.productId, row.id)),
  ]);
  const variants: ProductVariantDTO[] = sortBySize(variantRows).map((v) => ({
    id: v.id,
    size: v.size,
    sku: v.sku,
    stock: v.stock,
    available: v.stock > 0,
  }));
  const totalStock = variantRows.reduce((sum, v) => sum + v.stock, 0);
  return {
    id: row.id,
    slug: row.slug,
    version: row.version,
    title: row.title,
    descriptionExcerpt: excerpt(row.descriptionMarkdown),
    priceCents: row.priceCents,
    currency: CURRENCY,
    coverMediaId: pickCoverMediaId(media),
    availability: availabilityOf(variants.length, totalStock),
    totalStock,
    descriptionMarkdown: row.descriptionMarkdown,
    media,
    variants,
  };
}

/**
 * `listProducts` — a keyset page of active products (status='active' AND an
 * active immutable release), newest-updated first. Draft/unavailable/archived
 * products and products without an active release never appear. Availability +
 * cover come from live variant stock and the active release's frozen image set.
 */
export async function listActiveProductCards(
  db: Db,
  input: { limit?: number; cursor?: string },
): Promise<
  DomainResult<{ products: ProductCardDTO[]; nextCursor: string | null }, "invalid_cursor">
> {
  const limit = clampLimit(input.limit);
  let keyset;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (cursor === null) return err("invalid_cursor");
    const at = new Date(cursor.updatedAt);
    keyset = or(
      lt(productBase.updatedAt, at),
      and(eq(productBase.updatedAt, at), lt(productBase.id, cursor.id)),
    );
  }

  const rows = await db
    .select({
      id: productBase.id,
      slug: productBase.slug,
      updatedAt: productBase.updatedAt,
      releaseId: productRelease.id,
      version: productRelease.version,
      title: productRelease.title,
      descriptionMarkdown: productRelease.descriptionMarkdown,
      priceCents: productRelease.priceCents,
    })
    .from(productBase)
    .innerJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
    .where(and(eq(productBase.status, "active"), isNotNull(productBase.activeReleaseId), keyset))
    .orderBy(desc(productBase.updatedAt), desc(productBase.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (page.length === 0) return ok({ products: [], nextCursor: null });

  const productIds = page.map((r) => r.id);
  const releaseIds = page.map((r) => r.releaseId);

  const [variantRows, imageRows] = await Promise.all([
    db
      .select({ productId: productVariant.productId, stock: productVariant.stock })
      .from(productVariant)
      .where(inArray(productVariant.productId, productIds)),
    db
      .select({
        releaseId: productReleaseImage.releaseId,
        id: productImage.id,
        role: productReleaseImage.role,
      })
      .from(productReleaseImage)
      .innerJoin(productImage, eq(productImage.id, productReleaseImage.imageId))
      .where(
        and(inArray(productReleaseImage.releaseId, releaseIds), eq(productImage.state, "ready")),
      )
      .orderBy(asc(productReleaseImage.position)),
  ]);

  const stockByProduct = new Map<string, { total: number; count: number }>();
  for (const v of variantRows) {
    const cur = stockByProduct.get(v.productId) ?? { total: 0, count: 0 };
    stockByProduct.set(v.productId, { total: cur.total + v.stock, count: cur.count + 1 });
  }
  // imageRows arrive position-ascending; the first cover-role (else first) per
  // release wins — mirrors pickCoverMediaId for the detail path.
  const coverByRelease = new Map<string, string>();
  const lockedCover = new Set<string>();
  for (const img of imageRows) {
    if (img.role === "cover" && !lockedCover.has(img.releaseId)) {
      coverByRelease.set(img.releaseId, img.id);
      lockedCover.add(img.releaseId);
    } else if (!coverByRelease.has(img.releaseId)) {
      coverByRelease.set(img.releaseId, img.id);
    }
  }

  const products: ProductCardDTO[] = page.map((r) => {
    const roll = stockByProduct.get(r.id) ?? { total: 0, count: 0 };
    return {
      id: r.id,
      slug: r.slug,
      version: r.version,
      title: r.title,
      descriptionExcerpt: excerpt(r.descriptionMarkdown),
      priceCents: r.priceCents,
      currency: CURRENCY,
      coverMediaId: coverByRelease.get(r.releaseId) ?? null,
      availability: availabilityOf(roll.count, roll.total),
      totalStock: roll.total,
    };
  });

  const last = page[page.length - 1]!;
  const nextCursor = hasMore
    ? encodeCursor({ updatedAt: last.updatedAt.getTime(), id: last.id })
    : null;
  return ok({ products, nextCursor });
}

const ACTIVE_SELECTION = {
  id: productBase.id,
  slug: productBase.slug,
  releaseId: productRelease.id,
  version: productRelease.version,
  title: productRelease.title,
  descriptionMarkdown: productRelease.descriptionMarkdown,
  priceCents: productRelease.priceCents,
} as const;

/** `getProductBySlug` — the active-release detail DTO, or not_found for a missing,
 *  draft, unavailable, archived, or release-less product. */
export async function getActiveProductDetailBySlug(
  db: Db,
  slug: string,
): Promise<DomainResult<ProductDetailDTO, "not_found">> {
  const [row] = await db
    .select(ACTIVE_SELECTION)
    .from(productBase)
    .innerJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
    .where(and(eq(productBase.slug, slug), eq(productBase.status, "active")))
    .limit(1);
  if (!row) return err("not_found");
  return ok(await buildDetail(db, row));
}

/** `getProductById` — the active-release detail DTO by product id, or not_found. */
export async function getActiveProductDetailById(
  db: Db,
  productId: string,
): Promise<DomainResult<ProductDetailDTO, "not_found">> {
  const [row] = await db
    .select(ACTIVE_SELECTION)
    .from(productBase)
    .innerJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
    .where(and(eq(productBase.id, productId), eq(productBase.status, "active")))
    .limit(1);
  if (!row) return err("not_found");
  return ok(await buildDetail(db, row));
}

/**
 * INV-MEDIA-1 eligibility gate: resolve a domain media id to its private storage
 * key ONLY when the image is snapshotted in the ACTIVE release of an ACTIVE
 * product and the source image is 'ready'. Draft, unrelated, deleted, and
 * cross-product ids resolve to null. The storage key never leaves this module.
 */
export async function resolveOpenableMediaKey(db: Db, mediaId: string): Promise<string | null> {
  const [row] = await db
    .select({ storageKey: productImage.storageKey })
    .from(productReleaseImage)
    .innerJoin(productRelease, eq(productRelease.id, productReleaseImage.releaseId))
    .innerJoin(productBase, eq(productBase.id, productRelease.productId))
    .innerJoin(productImage, eq(productImage.id, productReleaseImage.imageId))
    .where(
      and(
        eq(productReleaseImage.imageId, mediaId),
        eq(productBase.status, "active"),
        eq(productBase.activeReleaseId, productRelease.id),
        eq(productImage.state, "ready"),
      ),
    )
    .limit(1);
  return row?.storageKey ?? null;
}

/**
 * `openProductMedia` — verify eligibility, then stream/redirect via the private
 * `MediaStorage` port's `read()`. The port yields a `Response`; pass it through.
 * Ineligible ids and a storage miss both surface as not_found (INV-MEDIA-1).
 */
export async function openProductMedia(
  db: Db,
  media: MediaStorage,
  mediaId: string,
): Promise<DomainResult<Response, "not_found">> {
  const key = await resolveOpenableMediaKey(db, mediaId);
  if (key === null) return err("not_found");
  const read = await media.read({ key });
  if (!read.ok) return err("not_found");
  return ok(read.value);
}
