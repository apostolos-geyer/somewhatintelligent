/**
 * D1 integration (real local D1 via miniflare): the RFC-0001 release-model
 * constraints hold in a real D1. Proves the load-bearing invariants of the
 * "Store D1 catalog revisions" schema:
 *   • product_release UNIQUE(product_id, version) — a retained version is never
 *     duplicated (immutable-while-retained).
 *   • product_image role/state CHECKs reject out-of-domain values.
 *   • product.active_release_id ON DELETE SET NULL — deleting a release clears
 *     the live pointer instead of cascading into the product.
 *   • product_variant constraints are unchanged (non-negative stock, unique SKU).
 *   • order_item has NO catalog FK — deleting a product/release never cascades
 *     into order history (INV-ORDER-1).
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedOrder, seedOrderItem, seedProduct, seedVariant } from "./helpers";

const { productBase, productRelease, productImage, customerOrder, orderItem } = schema;
const db = drizzle(env.DB, { schema });

async function seedRelease(over: Partial<typeof productRelease.$inferInsert> = {}) {
  await db.insert(productRelease).values({
    id: "r1",
    productId: "p1",
    version: "1.0.0",
    slug: "one",
    title: "Tee p1",
    priceCents: 3000,
    publishedBySub: "operator",
    publishedAt: new Date(),
    ...over,
  });
}

function imageValues(over: Partial<typeof productImage.$inferInsert> = {}) {
  return {
    id: "img1",
    productId: "p1",
    storageKey: "store/p1/img1",
    contentSha256: "a".repeat(64),
    contentType: "image/webp",
    sizeBytes: 1024,
    alt: "cover",
    role: "cover" as (typeof schema.PRODUCT_IMAGE_ROLES)[number],
    position: 0,
    state: "ready" as (typeof schema.PRODUCT_IMAGE_STATES)[number],
    createdAt: new Date(),
    readyAt: new Date(),
    ...over,
  } satisfies typeof productImage.$inferInsert;
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productBase); // cascades draft/release/image/variant
});

describe("product_release immutability (UNIQUE(product_id, version))", () => {
  it("rejects a second retained release with the same product + version", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedRelease({ id: "r1", version: "1.0.0" });
    await expect(
      seedRelease({ id: "r2", version: "1.0.0" }), // same (product_id, version) → throws
    ).rejects.toThrow();
  });

  it("allows distinct versions of the same product", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedRelease({ id: "r1", version: "1.0.0" });
    await seedRelease({ id: "r2", version: "1.1.0" });
    const rows = await db.select().from(productRelease).where(eq(productRelease.productId, "p1"));
    expect(rows).toHaveLength(2);
  });
});

describe("product_image role/state CHECKs", () => {
  it("rejects an out-of-domain role", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await expect(
      db
        .insert(productImage)
        .values(imageValues({ role: "banner" as (typeof schema.PRODUCT_IMAGE_ROLES)[number] })),
    ).rejects.toThrow();
  });

  it("rejects an out-of-domain state", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await expect(
      db
        .insert(productImage)
        .values(
          imageValues({ state: "uploading" as (typeof schema.PRODUCT_IMAGE_STATES)[number] }),
        ),
    ).rejects.toThrow();
  });

  it("rejects a negative size_bytes", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await expect(db.insert(productImage).values(imageValues({ sizeBytes: -1 }))).rejects.toThrow();
  });
});

describe("product.active_release_id ON DELETE SET NULL", () => {
  it("deleting the active release nulls the pointer and keeps the product", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedRelease({ id: "r1", version: "1.0.0" });
    await db.update(productBase).set({ activeReleaseId: "r1" }).where(eq(productBase.id, "p1"));

    await db.delete(productRelease).where(eq(productRelease.id, "r1"));

    const [prod] = await db.select().from(productBase).where(eq(productBase.id, "p1"));
    expect(prod).toBeDefined();
    expect(prod!.activeReleaseId).toBeNull(); // SET NULL, not cascade-delete
  });
});

describe("product_variant constraints unchanged", () => {
  it("rejects negative stock (stock_non_negative CHECK)", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await expect(
      seedVariant({ id: "v1", productId: "p1", size: "M", stock: -1 }),
    ).rejects.toThrow();
  });

  it("rejects a duplicate global SKU", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedProduct({ id: "p2", slug: "two" });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 1, sku: "DUP" });
    await expect(
      seedVariant({ id: "v2", productId: "p2", size: "L", stock: 1, sku: "DUP" }),
    ).rejects.toThrow();
  });
});

describe("order_item has no catalog FK (INV-ORDER-1)", () => {
  it("deleting a product's release — and the product itself — never touches order history", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });
    await seedRelease({ id: "r1", version: "1.0.0" });
    await seedOrder({ id: "o1", orderNumber: "SI-ITEMFK" });
    await seedOrderItem({
      id: "oi1",
      orderId: "o1",
      productId: "p1",
      variantId: "v1",
      quantity: 1,
    });

    // Delete the release: no cascade path into order_item.
    await db.delete(productRelease).where(eq(productRelease.id, "r1"));
    expect(await db.select().from(orderItem).where(eq(orderItem.id, "oi1"))).toHaveLength(1);

    // Delete the whole product aggregate: still no cascade into order_item.
    await db.delete(productBase).where(eq(productBase.id, "p1"));
    const [item] = await db
      .select()
      .from(orderItem)
      .where(and(eq(orderItem.id, "oi1"), eq(orderItem.orderId, "o1")));
    expect(item).toBeDefined();
    expect(item!.productId).toBe("p1"); // snapshot value survives catalog deletion
  });
});
