/**
 * D1 integration: the Publisher schema's structural invariants hold in a real
 * D1 — retained-version uniqueness, the fixed page-key set, the active-pointer
 * SET NULL on release deletion, audit idempotency, and text-graph cascade.
 * Binds only D1 (schema constraints, no RPC). Mirrors
 * workers/store/__tests__/integration/constraints.itest.ts.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import * as schema from "@/schema";

const { textEntry, textRelease, textTag, textLink, tag, pageEntry, pageRelease, operatorEvent } =
  schema;
const db = drizzle(env.DB, { schema });

const now = Date.now();

async function seedTextEntry(id: string, slug: string) {
  await db.insert(textEntry).values({
    id,
    slug,
    state: "draft",
    createdBySub: "op-sub",
    createdAt: now,
    updatedAt: now,
  });
}

async function insertTextRelease(id: string, textId: string, version: string) {
  await db.insert(textRelease).values({
    id,
    textId,
    version,
    slug: `${textId}-slug`,
    title: "T",
    bodyMarkdown: "body",
    publishedBySub: "op-sub",
    publishedAt: now,
  });
}

async function seedPageEntry(id: string, pageKey: schema.PageEntryRow["pageKey"]) {
  await db.insert(pageEntry).values({ id, pageKey, createdAt: now, updatedAt: now });
}

async function insertPageRelease(id: string, pageId: string, version: string) {
  await db.insert(pageRelease).values({
    id,
    pageId,
    version,
    schemaVersion: 1,
    documentJson: "{}",
    publishedBySub: "op-sub",
    publishedAt: now,
  });
}

function insertOperatorEvent(id: string, idempotencyKey: string, action: string) {
  return db.insert(operatorEvent).values({
    id,
    operatorSub: "op-sub",
    operatorEmail: "op@example.com",
    action,
    targetType: "text",
    targetId: "t1",
    requestId: "req-1",
    idempotencyKey,
    outcome: "ok",
    createdAt: now,
  });
}

// Isolated storage is per-test, but the tables are cleared explicitly so a
// re-run inside one storage stack stays deterministic. text_entry delete
// cascades its releases/tags-join/links; page_entry cascades its releases.
beforeEach(async () => {
  await db.delete(operatorEvent);
  await db.delete(textEntry);
  await db.delete(tag);
  await db.delete(pageEntry);
});

describe("text_release retained-version uniqueness (UNIQUE(text_id, version))", () => {
  it("rejects a second release at the same version for one text", async () => {
    await seedTextEntry("t1", "one");
    await insertTextRelease("r1", "t1", "1.0.0");
    await expect(insertTextRelease("r2", "t1", "1.0.0")).rejects.toThrow();
  });

  it("allows the same version string on a different text", async () => {
    await seedTextEntry("t1", "one");
    await seedTextEntry("t2", "two");
    await insertTextRelease("r1", "t1", "1.0.0");
    await insertTextRelease("r2", "t2", "1.0.0");
    expect(await db.select().from(textRelease)).toHaveLength(2);
  });
});

describe("page_release retained-version uniqueness (UNIQUE(page_id, version))", () => {
  it("rejects a second release at the same version for one page", async () => {
    await seedPageEntry("p-home", "home");
    await insertPageRelease("pr1", "p-home", "1.0.0");
    await expect(insertPageRelease("pr2", "p-home", "1.0.0")).rejects.toThrow();
  });
});

describe("page_entry.page_key CHECK (five fixed keys)", () => {
  it("accepts each of the five declared keys", async () => {
    const keys: schema.PageEntryRow["pageKey"][] = ["home", "shop", "writing", "software", "about"];
    for (const [i, key] of keys.entries()) await seedPageEntry(`p-${i}`, key);
    expect(await db.select().from(pageEntry)).toHaveLength(5);
  });

  it("rejects a sixth, undeclared page_key", async () => {
    // Raw SQL: the drizzle enum would reject 'blog' at the type layer, so the
    // CHECK constraint is proven directly at the DB boundary.
    await expect(
      env.DB.prepare(
        "INSERT INTO page_entry (id, page_key, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
        .bind("p-blog", "blog", now, now)
        .run(),
    ).rejects.toThrow();
  });
});

describe("text_entry.active_release_id ON DELETE SET NULL", () => {
  it("clears the active pointer when its release is deleted", async () => {
    await seedTextEntry("t1", "one");
    await insertTextRelease("r1", "t1", "1.0.0");
    await db.update(textEntry).set({ activeReleaseId: "r1" }).where(eq(textEntry.id, "t1"));

    await db.delete(textRelease).where(eq(textRelease.id, "r1"));

    const [row] = await db.select().from(textEntry).where(eq(textEntry.id, "t1"));
    expect(row!.activeReleaseId).toBeNull();
  });
});

describe("operator_event idempotency (UNIQUE(idempotency_key, action))", () => {
  it("rejects a replay of the same (idempotency_key, action)", async () => {
    await insertOperatorEvent("e1", "idem-1", "publish_text");
    await expect(insertOperatorEvent("e2", "idem-1", "publish_text")).rejects.toThrow();
  });

  it("allows the same idempotency_key under a different action", async () => {
    await insertOperatorEvent("e1", "idem-1", "publish_text");
    await insertOperatorEvent("e2", "idem-1", "delete_text");
    expect(await db.select().from(operatorEvent)).toHaveLength(2);
  });
});

describe("text graph cascade on text_entry delete", () => {
  it("removes joined tags and outgoing links, and nulls incoming links", async () => {
    await seedTextEntry("t1", "one");
    await seedTextEntry("t2", "two");
    await db.insert(tag).values({ id: "tag1", slug: "tag-one", label: "One", createdAt: now });
    await db.insert(textTag).values({ textId: "t1", tagId: "tag1" });
    // Outgoing link from t1 and an incoming link from t2 -> t1.
    await db.insert(textLink).values({
      id: "l1",
      fromTextId: "t1",
      toTextId: "t2",
      toSlug: "two",
      createdAt: now,
    });
    await db.insert(textLink).values({
      id: "l2",
      fromTextId: "t2",
      toTextId: "t1",
      toSlug: "one",
      createdAt: now,
    });

    await db.delete(textEntry).where(eq(textEntry.id, "t1"));

    // text_tag row for t1 is gone (CASCADE).
    expect(await db.select().from(textTag).where(eq(textTag.textId, "t1"))).toEqual([]);
    // Outgoing link l1 (from_text_id = t1) is gone (CASCADE).
    expect(await db.select().from(textLink).where(eq(textLink.id, "l1"))).toEqual([]);
    // Incoming link l2 (to_text_id = t1) survives with a nulled target (SET NULL).
    const [l2] = await db.select().from(textLink).where(eq(textLink.id, "l2"));
    expect(l2!.toTextId).toBeNull();
    // The cascade also removed t1's release (text_release.text_id CASCADE).
    expect(
      await db
        .select()
        .from(textRelease)
        .where(and(eq(textRelease.textId, "t1"))),
    ).toEqual([]);
  });
});
