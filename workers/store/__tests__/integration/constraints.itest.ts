/**
 * D1 integration: the schema constraints the app relies on actually hold in a
 * real D1 (insert a violating row, expect the D1 call to throw). Binds only D1.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";

const { product, productImage, productVariant } = schema;
const db = drizzle(env.DB, { schema });

async function seedProduct(id: string, slug: string) {
  const now = new Date();
  await db.insert(product).values({
    id,
    slug,
    title: id,
    priceCents: 1000,
    status: "active",
    createdBy: "admin",
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(async () => {
  await db.delete(productImage);
  await db.delete(productVariant);
  await db.delete(product);
});

describe("catalog constraints", () => {
  it("SKU is globally unique", async () => {
    await seedProduct("p1", "one");
    await seedProduct("p2", "two");
    await db.insert(productVariant).values({
      id: "v1",
      productId: "p1",
      size: "M",
      sku: "DUP-SKU",
      stock: 1,
      createdAt: new Date(),
    });
    await expect(
      db.insert(productVariant).values({
        id: "v2",
        productId: "p2",
        size: "L",
        sku: "DUP-SKU", // same SKU on a different product → must throw
        stock: 1,
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("(productId, size) is unique — no two variants of the same size per product", async () => {
    await seedProduct("p1", "one");
    await db.insert(productVariant).values({
      id: "v1",
      productId: "p1",
      size: "M",
      sku: "SKU-A",
      stock: 1,
      createdAt: new Date(),
    });
    await expect(
      db.insert(productVariant).values({
        id: "v2",
        productId: "p1",
        size: "M", // duplicate size for the same product → must throw
        sku: "SKU-B",
        stock: 1,
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it("product.slug is unique", async () => {
    await seedProduct("p1", "same-slug");
    await expect(seedProduct("p2", "same-slug")).rejects.toThrow();
  });

  it("deleting a product cascades its variants and images", async () => {
    await seedProduct("p1", "one");
    await db.insert(productVariant).values({
      id: "v1",
      productId: "p1",
      size: "M",
      sku: "SKU-A",
      stock: 1,
      createdAt: new Date(),
    });
    await db.insert(productImage).values({
      id: "img1",
      productId: "p1",
      roadieReferenceId: "ref",
      position: 0,
      uploadedAt: new Date(),
      createdAt: new Date(),
    });

    await db.delete(product).where(eq(product.id, "p1"));
    expect(
      await db.select().from(productVariant).where(eq(productVariant.productId, "p1")),
    ).toEqual([]);
    expect(await db.select().from(productImage).where(eq(productImage.productId, "p1"))).toEqual(
      [],
    );
  });
});
