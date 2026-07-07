/**
 * Integration probe (real local D1): the contact thread carries the new
 * "Area of store" field end to end — `sendContact` writes it, and the thread/inbox
 * reads project it back. Replays the exact insert + select-projection the server
 * fns use, so the new column is exercised against a real row, brand-scoped.
 */
import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { contactThreads } from "@/schema";

const db = createDb(env.DB);
const BRAND = "org_contact";
const USER = "user_bud";

beforeEach(async () => {
  await db.delete(contactThreads);
});

function seed(id: string, areaOfStore: string | null, brandId = BRAND, userId = USER) {
  return db.insert(contactThreads).values({
    id,
    brandId,
    userId,
    authorName: "Bud",
    store: "acme",
    areaOfStore,
    email: "bud@example.com",
    topic: "Restocking",
    message: "Need more shelf talkers",
    status: "open",
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("contact thread — area of store (real D1)", () => {
  it("persists area_of_store and reads it back on the thread projection", async () => {
    await seed("t1", "Sales floor");

    const row = (
      await db
        .select({
          id: contactThreads.id,
          areaOfStore: contactThreads.areaOfStore,
          topic: contactThreads.topic,
        })
        .from(contactThreads)
        .where(and(eq(contactThreads.brandId, BRAND), eq(contactThreads.userId, USER)))
        .limit(1)
    ).at(0);

    expect(row).toMatchObject({ id: "t1", areaOfStore: "Sales floor", topic: "Restocking" });
  });

  it("area_of_store is optional (null when not chosen)", async () => {
    await seed("t2", null);
    const row = (await db.select().from(contactThreads).where(eq(contactThreads.id, "t2"))).at(0)!;
    expect(row.areaOfStore).toBeNull();
  });
});
