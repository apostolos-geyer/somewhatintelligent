/**
 * D1 integration: the schema constraints the app relies on actually hold in a
 * real D1 (insert a violating row, expect the D1 call to throw). Binds only D1.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { seedProduct } from "./helpers";

const { productBase, productImage, productVariant, customerOrder } = schema;
const db = drizzle(env.DB, { schema });

// A minimal ready product image in the storage-neutral shape.
function imageValues(over: Partial<typeof productImage.$inferInsert> = {}) {
  return {
    id: "img1",
    productId: "p1",
    storageKey: "store/p1/img1",
    contentSha256: "a".repeat(64),
    contentType: "image/webp",
    sizeBytes: 1024,
    alt: "cover",
    role: "cover" as const,
    position: 0,
    state: "ready" as const,
    createdAt: new Date(),
    readyAt: new Date(),
    ...over,
  } satisfies typeof productImage.$inferInsert;
}

beforeEach(async () => {
  // Deleting the identity row cascades draft/release/image/variant.
  await db.delete(productBase);
  await db.delete(customerOrder);
});

describe("catalog constraints", () => {
  it("SKU is globally unique", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await seedProduct({ id: "p2", slug: "two" });
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
    await seedProduct({ id: "p1", slug: "one" });
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
    await seedProduct({ id: "p1", slug: "same-slug" });
    await expect(seedProduct({ id: "p2", slug: "same-slug" })).rejects.toThrow();
  });

  it("product_image.storage_key is globally unique", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await db.insert(productImage).values(imageValues({ id: "img1" }));
    await expect(
      db.insert(productImage).values(imageValues({ id: "img2", position: 1 })),
    ).rejects.toThrow(); // same storage_key → must throw
  });

  it("deleting a product cascades its variants and images", async () => {
    await seedProduct({ id: "p1", slug: "one" });
    await db.insert(productVariant).values({
      id: "v1",
      productId: "p1",
      size: "M",
      sku: "SKU-A",
      stock: 1,
      createdAt: new Date(),
    });
    await db.insert(productImage).values(imageValues());

    await db.delete(productBase).where(eq(productBase.id, "p1"));
    expect(
      await db.select().from(productVariant).where(eq(productVariant.productId, "p1")),
    ).toEqual([]);
    expect(await db.select().from(productImage).where(eq(productImage.productId, "p1"))).toEqual(
      [],
    );
  });
});

describe("customer_order address atomicity (ship_address_atomic CHECK)", () => {
  const baseOrder = (over: Partial<typeof customerOrder.$inferInsert>) => {
    const now = new Date();
    return {
      id: "o1",
      orderNumber: "SI-ATOMIC1",
      userId: "buyer-1",
      email: "b@e.com",
      subtotalCents: 1000,
      totalCents: 1000,
      createdAt: now,
      updatedAt: now,
      ...over,
    } satisfies typeof customerOrder.$inferInsert;
  };

  it("rejects a half-written address (some core fields set, others NULL)", async () => {
    await expect(
      // name + line1 set, city/region/postal NULL → CHECK violation.
      db.insert(customerOrder).values(baseOrder({ shipName: "Ada", shipLine1: "1 Main" })),
    ).rejects.toThrow();
  });

  it("accepts an all-NULL address (pre-payment order)", async () => {
    await db.insert(customerOrder).values(baseOrder({}));
    const [row] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o1"));
    expect(row!.shipName).toBeNull();
  });

  it("accepts a fully-collected address", async () => {
    await db.insert(customerOrder).values(
      baseOrder({
        id: "o2",
        orderNumber: "SI-ATOMIC2",
        shipName: "Ada",
        shipLine1: "1 Main",
        shipCity: "Toronto",
        shipRegion: "ON",
        shipPostal: "M5V",
      }),
    );
    const [row] = await db.select().from(customerOrder).where(eq(customerOrder.id, "o2"));
    expect(row!.shipPostal).toBe("M5V");
  });
});
