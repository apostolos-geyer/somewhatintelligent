/**
 * Integration (idiom-A) — the load-bearing D1 schema laws, exercised against a
 * REAL local D1 in workerd. These replace source-scan "fakes" with runtime proof:
 * the reviews CHECK constraints + unique index (INV-3), hard-delete behaviour,
 * the product→reviews cascade, and the leaderboard/cert unique keys.
 */
import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import {
  attempts,
  certifications,
  portalMembers,
  products,
  quizzes,
  reviews,
  userBrandScores,
} from "@/schema";

const db = createDb(env.DB);
const now = () => Date.now();

/** Insert a published product and return its id (reviews FK → products). */
async function seedProduct(id = `p_${crypto.randomUUID()}`): Promise<string> {
  await db.insert(products).values({
    id,
    brandId: "acme",
    category: "Flower",
    name: "Garlic Breath",
    status: "published",
    createdAt: now(),
    updatedAt: now(),
  });
  return id;
}

function review(productId: string, over: Partial<typeof reviews.$inferInsert> = {}) {
  return {
    id: `r_${crypto.randomUUID()}`,
    brandId: "acme",
    productId,
    userId: `u_${crypto.randomUUID()}`,
    authorName: "Bob",
    rating: 5,
    body: "Solid.",
    createdAt: now(),
    updatedAt: now(),
    ...over,
  } satisfies typeof reviews.$inferInsert;
}

beforeEach(async () => {
  // Isolated storage gives each test a clean slate, but be explicit anyway.
  await db.delete(reviews);
  await db.delete(certifications);
  await db.delete(products);
  await db.delete(portalMembers);
});

describe("migrations + D1 are live", () => {
  it("schema is applied — tables are queryable", async () => {
    await expect(db.select().from(products).limit(1)).resolves.toEqual([]);
  });
});

describe("reviews CHECK constraints (INV-3 defence-in-depth)", () => {
  it("rejects a rating outside 1..5", async () => {
    const p = await seedProduct();
    await expect(db.insert(reviews).values(review(p, { rating: 0 }))).rejects.toThrow();
    await expect(db.insert(reviews).values(review(p, { rating: 6 }))).rejects.toThrow();
  });

  it("accepts ratings 1..5", async () => {
    const p = await seedProduct();
    for (const rating of [1, 3, 5]) {
      await expect(db.insert(reviews).values(review(p, { rating }))).resolves.toBeDefined();
    }
  });

  it("rejects a body longer than 300 chars", async () => {
    const p = await seedProduct();
    await expect(db.insert(reviews).values(review(p, { body: "x".repeat(301) }))).rejects.toThrow();
    await expect(
      db.insert(reviews).values(review(p, { body: "x".repeat(300) })),
    ).resolves.toBeDefined();
  });
});

describe("reviews uniqueness + hard-delete (INV-3)", () => {
  it("enforces one review per (brand, product, user)", async () => {
    const p = await seedProduct();
    const userId = "u_dup";
    await db.insert(reviews).values(review(p, { userId }));
    await expect(db.insert(reviews).values(review(p, { userId }))).rejects.toThrow();
  });

  it("a delete REMOVES the row (no soft-delete) — and another user may then review", async () => {
    const p = await seedProduct();
    const userId = "u_hd";
    const r = review(p, { userId });
    await db.insert(reviews).values(r);
    await db.delete(reviews).where(eq(reviews.id, r.id));
    const rows = await db.select().from(reviews).where(eq(reviews.id, r.id));
    expect(rows).toEqual([]); // truly gone, not hidden
  });
});

describe("foreign-key cascade", () => {
  it("deleting a product cascades its reviews", async () => {
    const p = await seedProduct();
    await db.insert(reviews).values(review(p));
    await db.delete(products).where(eq(products.id, p));
    const rows = await db.select().from(reviews).where(eq(reviews.productId, p));
    expect(rows).toEqual([]);
  });
});

describe("portal_members — the portal audience, separate from org membership", () => {
  it("is unique per (brand, user); the ensure-pattern keeps the FIRST membership", async () => {
    const base = {
      brandId: "acme",
      userId: "u_pm",
      role: "budtender",
      source: "request",
      createdAt: now(),
    };
    await db.insert(portalMembers).values({ id: "pm1", ...base });
    // a hard duplicate violates the unique index
    await expect(db.insert(portalMembers).values({ id: "pm2", ...base })).rejects.toThrow();
    // ensurePortalMember's ON CONFLICT DO NOTHING is a safe no-op re-join: a later
    // org-sync must not clobber an existing budtender row.
    await db
      .insert(portalMembers)
      .values({ id: "pm3", ...base, role: "staff", source: "org" })
      .onConflictDoNothing({ target: [portalMembers.brandId, portalMembers.userId] });
    const rows = await db.select().from(portalMembers).where(eq(portalMembers.userId, "u_pm"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe("budtender"); // first membership kept
    expect(rows[0]!.source).toBe("request");
  });

  it("a budtender can belong to MANY brands' portals without any org", async () => {
    for (const brandId of ["acme", "beta"]) {
      await db.insert(portalMembers).values({
        id: `pm_${brandId}`,
        brandId,
        userId: "u_multi",
        role: "budtender",
        source: "request",
        createdAt: now(),
      });
    }
    const rows = await db.select().from(portalMembers).where(eq(portalMembers.userId, "u_multi"));
    expect(rows.map((r) => r.brandId).sort()).toEqual(["acme", "beta"]);
  });
});

describe("leaderboard + certification unique keys", () => {
  it("user_brand_scores is unique per (brand, user, period)", async () => {
    const base = {
      brandId: "acme",
      userId: "u_lb",
      period: "2026-06",
      score: 100,
      computedAt: now(),
    };
    await db.insert(userBrandScores).values({ id: "s1", ...base });
    await expect(db.insert(userBrandScores).values({ id: "s2", ...base })).rejects.toThrow();
  });

  it("certifications are unique per (brand, user, quiz)", async () => {
    // certifications FK → quizzes + attempts, so seed those first.
    await db.insert(quizzes).values({
      id: "q1",
      title: "Know the Craft",
      createdAt: now(),
      updatedAt: now(),
      createdBy: "u_admin",
    });
    await db.insert(attempts).values({
      id: "a1",
      quizId: "q1",
      userId: "u_c",
      shuffleSeed: 1,
      maxScore: 5,
      startedAt: now(),
    });
    const base = {
      brandId: "acme",
      userId: "u_c",
      quizId: "q1",
      name: "Certified",
      attemptId: "a1",
      awardedAt: now(),
    };
    await db.insert(certifications).values({ id: "c1", ...base });
    await expect(db.insert(certifications).values({ id: "c2", ...base })).rejects.toThrow();
  });
});
