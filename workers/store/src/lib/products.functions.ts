// Product catalog server functions. Public reads are unauthenticated (but
// refuse to serve while the launch gate is closed — see storeOpenFor); every
// mutation is gated by `requireAdminMiddleware` (catalog management is
// admin-only per the brief + RFC-011 role hierarchy).
import { createServerFn } from "@tanstack/react-start";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { type } from "arktype";

import { product, productImage, productVariant } from "@/db/schema";
import { getDb } from "@/lib/db";
import { ulid } from "@somewhatintelligent/kit/ids";
import { authMiddleware, requireAdminMiddleware } from "@/lib/middleware/auth";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { buildProductMaps, skuFor, slugify, sortBySize } from "@/lib/catalog";
import { storeOpenFor } from "@/lib/store-gate";

// ── Public reads ─────────────────────────────────────────────────────────────

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  coverRef: string | null;
  inStock: boolean;
}

export const listActiveProducts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ products: ProductCard[] }> => {
    if (!storeOpenFor(context.session)) throw new ForbiddenError();
    const db = getDb();
    const rows = await db
      .select()
      .from(product)
      .where(eq(product.status, "active"))
      .orderBy(desc(product.createdAt));
    if (rows.length === 0) return { products: [] };

    const ids = rows.map((r) => r.id);
    const [images, variants] = await Promise.all([
      db.select().from(productImage).where(inArray(productImage.productId, ids)),
      db.select().from(productVariant).where(inArray(productVariant.productId, ids)),
    ]);
    const { cover, stock } = buildProductMaps(images, variants);

    return {
      products: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        priceCents: r.priceCents,
        coverRef: cover.get(r.id) ?? null,
        inStock: (stock.get(r.id) ?? 0) > 0,
      })),
    };
  });

export const getProductBySlug = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator((data: { slug: string }) => type({ slug: "string" }).assert(data))
  .handler(async ({ data, context }) => {
    if (!storeOpenFor(context.session)) throw new ForbiddenError();
    const db = getDb();
    const [row] = await db.select().from(product).where(eq(product.slug, data.slug)).limit(1);
    if (!row || row.status !== "active") throw new NotFoundError();

    const [images, variants] = await Promise.all([
      db
        .select()
        .from(productImage)
        .where(eq(productImage.productId, row.id))
        .orderBy(asc(productImage.position)),
      db.select().from(productVariant).where(eq(productVariant.productId, row.id)),
    ]);

    return {
      product: row,
      images: images.filter((i) => i.uploadedAt),
      variants: sortBySize(variants),
    };
  });

// ── Admin reads ──────────────────────────────────────────────────────────────

export const listAllProducts = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const db = getDb();
    const rows = await db.select().from(product).orderBy(desc(product.updatedAt));
    const ids = rows.map((r) => r.id);
    const [variants, images] = ids.length
      ? await Promise.all([
          db.select().from(productVariant).where(inArray(productVariant.productId, ids)),
          db.select().from(productImage).where(inArray(productImage.productId, ids)),
        ])
      : [[], []];
    const { cover, stock } = buildProductMaps(images, variants);
    return {
      products: rows.map((r) => ({
        ...r,
        totalStock: stock.get(r.id) ?? 0,
        coverRef: cover.get(r.id) ?? null,
      })),
    };
  });

export const getProductAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => type({ id: "string" }).assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    const [row] = await db.select().from(product).where(eq(product.id, data.id)).limit(1);
    if (!row) throw new NotFoundError();
    const [images, variants] = await Promise.all([
      db
        .select()
        .from(productImage)
        .where(eq(productImage.productId, row.id))
        .orderBy(asc(productImage.position)),
      db.select().from(productVariant).where(eq(productVariant.productId, row.id)),
    ]);
    return { product: row, images, variants: sortBySize(variants) };
  });

// ── Admin mutations ──────────────────────────────────────────────────────────

const createProductInput = type({
  title: "2 <= string <= 120",
  priceCents: "number.integer >= 0",
  "description?": "string <= 4000",
  "slug?": "string <= 64",
});

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof createProductInput.infer) => createProductInput.assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const baseSlug = slugify(data.slug || data.title) || `product-${Date.now()}`;
    // Ensure slug uniqueness with a short suffix on collision.
    let slug = baseSlug;
    const [clash] = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.slug, slug))
      .limit(1);
    if (clash) slug = `${baseSlug}-${ulid().slice(-5).toLowerCase()}`;

    const id = ulid();
    const now = new Date();
    await db.insert(product).values({
      id,
      slug,
      title: data.title,
      description: data.description ?? null,
      priceCents: data.priceCents,
      status: "draft",
      createdBy: context.session.user.id,
      createdAt: now,
      updatedAt: now,
    });
    return { id, slug };
  });

const updateProductInput = type({
  id: "string",
  "title?": "2 <= string <= 120",
  "priceCents?": "number.integer >= 0",
  "description?": "string <= 4000",
  "status?": "'draft' | 'active' | 'archived'",
});

export const updateProduct = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof updateProductInput.infer) => updateProductInput.assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.priceCents !== undefined) patch.priceCents = data.priceCents;
    if (data.description !== undefined) patch.description = data.description;
    if (data.status !== undefined) patch.status = data.status;
    await db.update(product).set(patch).where(eq(product.id, data.id));
    return { ok: true as const };
  });

const variantInput = type({
  productId: "string",
  size: "1 <= string <= 12",
  "sku?": "string <= 64",
  stock: "number.integer >= 0",
});

export const addVariant = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof variantInput.infer) => variantInput.assert(data))
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; error: string }> => {
    const db = getDb();
    const [p] = await db.select().from(product).where(eq(product.id, data.productId)).limit(1);
    if (!p) throw new NotFoundError();
    const [dupe] = await db
      .select({ id: productVariant.id })
      .from(productVariant)
      .where(and(eq(productVariant.productId, data.productId), eq(productVariant.size, data.size)))
      .limit(1);
    if (dupe) return { ok: false, error: "size_exists" };
    const sku = data.sku?.trim() || skuFor(p.slug, data.size);
    await db.insert(productVariant).values({
      id: ulid(),
      productId: data.productId,
      size: data.size,
      sku,
      stock: data.stock,
      createdAt: new Date(),
    });
    return { ok: true };
  });

const updateVariantInput = type({ id: "string", stock: "number.integer >= 0" });

export const updateVariantStock = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof updateVariantInput.infer) => updateVariantInput.assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    await db
      .update(productVariant)
      .set({ stock: data.stock })
      .where(eq(productVariant.id, data.id));
    return { ok: true as const };
  });

export const deleteVariant = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => type({ id: "string" }).assert(data))
  .handler(async ({ data }) => {
    const db = getDb();
    await db.delete(productVariant).where(eq(productVariant.id, data.id));
    return { ok: true as const };
  });
