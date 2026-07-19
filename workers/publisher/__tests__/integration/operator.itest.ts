/**
 * D1 integration: the `PublisherOperator` mutation core (T16) against a REAL
 * local D1. Proves INV-REL-1 (immutable release; later drafts never rewrite
 * release bytes; a duplicate retained version fails), INV-SW-1/INV-SW-2 (no
 * software version; a draft save never touches the public snapshot or its
 * `updatedAt`; publish bumps it), INV-AUDIT-1 (one event per mutation in one
 * batch; a replayed idempotency key returns the recorded response without a
 * second event or a second mutation), optimistic concurrency, the atomic
 * tags+wikilinks save, the https/loopback destination rule, and primary-media
 * ownership. Binds only DB; the writes core takes `environment` as a dep.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import * as schema from "@/schema";
import type { OperatorCall } from "@si/contracts";
import { PublisherOperatorWrites } from "@/operator/writes";

const db = drizzle(env.DB, { schema });

const {
  textEntry,
  textDraft,
  textRelease,
  tag,
  textTag,
  textLink,
  softwareEntry,
  softwareDraft,
  softwarePublication,
  softwarePublicationMedia,
  publisherMedia,
  publisherReleaseMedia,
  operatorEvent,
} = schema;

const SUB = "op-sub";
const EMAIL = "op@example.com";

function writes(environment = "production"): PublisherOperatorWrites {
  return new PublisherOperatorWrites({ db, environment });
}

// Build an OperatorCall; a fresh idempotency key per call unless one is pinned.
function call<T>(input: T, idempotencyKey = crypto.randomUUID()): OperatorCall<T> {
  return {
    input,
    meta: {
      actor: { sub: SUB, email: EMAIL },
      requestId: crypto.randomUUID(),
      idempotencyKey,
    },
  };
}

async function seedReadyMedia(
  id: string,
  ownerType: "text" | "software",
  ownerId: string,
  position = 0,
) {
  await db.insert(publisherMedia).values({
    id,
    ownerType,
    ownerId,
    storageKey: `key-${id}`,
    contentSha256: "a".repeat(64),
    contentType: "image/png",
    sizeBytes: 100,
    width: 800,
    height: 600,
    role: "gallery",
    alt: `alt ${id}`,
    position,
    state: "ready",
    createdBySub: SUB,
    createdAt: 1,
  });
}

async function createTextOk(slug: string, title = "Title"): Promise<string> {
  const res = await writes().createText(call({ slug, title }));
  if (!res.ok) throw new Error(`createText failed: ${res.error}`);
  return res.value.textId;
}

async function createSoftwareOk(slug: string, title = "Tool"): Promise<string> {
  const res = await writes().createSoftware(call({ slug, title }));
  if (!res.ok) throw new Error(`createSoftware failed: ${res.error}`);
  return res.value.softwareId;
}

beforeEach(async () => {
  await db.delete(publisherReleaseMedia);
  await db.delete(softwarePublicationMedia);
  await db.delete(publisherMedia);
  await db.delete(textEntry);
  await db.delete(softwareEntry);
  await db.delete(tag);
  await db.delete(operatorEvent);
});

// ── text drafts: create + optimistic concurrency ─────────────────────────────

describe("text drafts — revision + optimistic concurrency", () => {
  it("createText starts at revision 1 and a save increments it", async () => {
    const textId = await createTextOk("essay");

    const [draft0] = await db.select().from(textDraft).where(eq(textDraft.textId, textId));
    expect(draft0?.revision).toBe(1);

    const saved = await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "hello" }),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(2);

    const [draft1] = await db.select().from(textDraft).where(eq(textDraft.textId, textId));
    expect(draft1?.revision).toBe(2);
    expect(draft1?.bodyMarkdown).toBe("hello");
  });

  it("createText rejects a taken slug", async () => {
    await createTextOk("dupe");
    const res = await writes().createText(call({ slug: "dupe", title: "x" }));
    expect(res).toEqual({ ok: false, error: "slug_taken" });
  });

  it("a stale expectedRevision returns revision_conflict without mutation", async () => {
    const textId = await createTextOk("essay");
    const first = await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "v2" }),
    );
    expect(first.ok).toBe(true);

    const stale = await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "should not apply" }),
    );
    expect(stale).toEqual({ ok: false, error: "revision_conflict" });

    const [draft] = await db.select().from(textDraft).where(eq(textDraft.textId, textId));
    expect(draft?.revision).toBe(2);
    expect(draft?.bodyMarkdown).toBe("v2");
    // The conflicting save wrote no event.
    const events = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.targetId, textId), eq(operatorEvent.action, "text.save")));
    expect(events.length).toBe(1);
  });

  it("saveTextDraft is not_found for an unknown text", async () => {
    const res = await writes().saveTextDraft(
      call({ textId: "nope", expectedRevision: 1, title: "x" }),
    );
    expect(res).toEqual({ ok: false, error: "not_found" });
  });
});

// ── tags + wikilinks atomic with save ─────────────────────────────────────────

describe("saveTextDraft — tags + wikilinks update atomically", () => {
  it("writes tag links and resolves/dangles wikilinks in one save", async () => {
    const target = await createTextOk("target-slug", "Target");
    const from = await createTextOk("from-slug", "From");

    const saved = await writes().saveTextDraft(
      call({
        textId: from,
        expectedRevision: 1,
        tags: ["philosophy", "essays", "philosophy"],
        bodyMarkdown: "See [[target-slug]] and [[missing-slug|alias]] and [[target-slug#h]].",
      }),
    );
    expect(saved.ok).toBe(true);

    const tagRows = await db
      .select({ slug: tag.slug })
      .from(textTag)
      .innerJoin(tag, eq(tag.id, textTag.tagId))
      .where(eq(textTag.textId, from));
    expect(tagRows.map((r) => r.slug).sort()).toEqual(["essays", "philosophy"]);

    const links = await db.select().from(textLink).where(eq(textLink.fromTextId, from));
    const bySlug = new Map(links.map((l) => [l.toSlug, l]));
    expect(bySlug.size).toBe(2); // deduped: target-slug appears once
    expect(bySlug.get("target-slug")?.isDangling).toBe(0);
    expect(bySlug.get("target-slug")?.toTextId).toBe(target);
    expect(bySlug.get("missing-slug")?.isDangling).toBe(1);
    expect(bySlug.get("missing-slug")?.toTextId).toBeNull();
  });

  it("a later save replaces the prior tags and links", async () => {
    const textId = await createTextOk("essay");
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, tags: ["a"], bodyMarkdown: "[[x]]" }),
    );
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 2, tags: ["b"], bodyMarkdown: "no links here" }),
    );

    const tagRows = await db
      .select({ slug: tag.slug })
      .from(textTag)
      .innerJoin(tag, eq(tag.id, textTag.tagId))
      .where(eq(textTag.textId, textId));
    expect(tagRows.map((r) => r.slug)).toEqual(["b"]);
    const links = await db.select().from(textLink).where(eq(textLink.fromTextId, textId));
    expect(links.length).toBe(0);
  });
});

// ── text publish: immutable release + pointer + one-batch event ───────────────

describe("publishText — immutable release, pointer move, one-batch audit", () => {
  it("writes a release, advances the active pointer, and logs one publish event", async () => {
    const textId = await createTextOk("essay", "My Essay");
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "Published body.", tags: ["x"] }),
    );

    const pub = await writes().publishText(call({ textId, expectedRevision: 2, version: "1.0.0" }));
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    const [release] = await db
      .select()
      .from(textRelease)
      .where(eq(textRelease.id, pub.value.releaseId));
    expect(release?.version).toBe("1.0.0");
    expect(release?.bodyMarkdown).toBe("Published body.");
    expect(release?.title).toBe("My Essay");
    expect(JSON.parse(release?.tagsJson ?? "[]")).toEqual(["x"]);

    const [entry] = await db.select().from(textEntry).where(eq(textEntry.id, textId));
    expect(entry?.activeReleaseId).toBe(pub.value.releaseId);
    expect(entry?.state).toBe("published");

    const publishEvents = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.targetId, textId), eq(operatorEvent.action, "text.publish")));
    expect(publishEvents.length).toBe(1);
    expect(publishEvents[0]?.operatorSub).toBe(SUB);
  });

  it("snapshots ready media into the release (INV-MEDIA snapshot)", async () => {
    const textId = await createTextOk("withmedia");
    await seedReadyMedia("m1", "text", textId, 0);
    const pub = await writes().publishText(call({ textId, expectedRevision: 1, version: "1.0.0" }));
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;
    const snap = await db
      .select()
      .from(publisherReleaseMedia)
      .where(eq(publisherReleaseMedia.releaseId, pub.value.releaseId));
    expect(snap.map((s) => s.mediaId)).toEqual(["m1"]);
  });

  it("rejects a non-SemVer version and a stale revision", async () => {
    const textId = await createTextOk("essay");
    expect(
      await writes().publishText(call({ textId, expectedRevision: 1, version: "edition-2" })),
    ).toEqual({ ok: false, error: "invalid_version" });
    expect(
      await writes().publishText(call({ textId, expectedRevision: 99, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "revision_conflict" });
  });

  it("publishText is not_found for an unknown text", async () => {
    const res = await writes().publishText(
      call({ textId: "nope", expectedRevision: 1, version: "1.0.0" }),
    );
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("a later draft edit leaves the published release bytes unchanged (INV-REL-1)", async () => {
    const textId = await createTextOk("essay");
    await writes().saveTextDraft(call({ textId, expectedRevision: 1, bodyMarkdown: "ORIGINAL" }));
    const pub = await writes().publishText(call({ textId, expectedRevision: 2, version: "1.0.0" }));
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    await writes().saveTextDraft(call({ textId, expectedRevision: 2, bodyMarkdown: "REWRITTEN" }));

    const [release] = await db
      .select()
      .from(textRelease)
      .where(eq(textRelease.id, pub.value.releaseId));
    expect(release?.bodyMarkdown).toBe("ORIGINAL");
    const [draft] = await db.select().from(textDraft).where(eq(textDraft.textId, textId));
    expect(draft?.bodyMarkdown).toBe("REWRITTEN");
  });

  it("a duplicate retained version fails with version_exists", async () => {
    const textId = await createTextOk("essay");
    const first = await writes().publishText(
      call({ textId, expectedRevision: 1, version: "1.0.0" }),
    );
    expect(first.ok).toBe(true);
    // Republish the same retained version (revision unchanged by publish).
    const dup = await writes().publishText(call({ textId, expectedRevision: 1, version: "1.0.0" }));
    expect(dup).toEqual({ ok: false, error: "version_exists" });
  });
});

// ── retire ────────────────────────────────────────────────────────────────────

describe("retireText / retireSoftware", () => {
  it("retireText moves the entry to retired and is not_found for unknown", async () => {
    const textId = await createTextOk("essay");
    const res = await writes().retireText(call({ textId }));
    expect(res).toEqual({ ok: true, value: { state: "retired" } });
    const [entry] = await db.select().from(textEntry).where(eq(textEntry.id, textId));
    expect(entry?.state).toBe("retired");
    expect(entry?.retiredAt).not.toBeNull();

    expect(await writes().retireText(call({ textId: "nope" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

// ── idempotency replay ─────────────────────────────────────────────────────────

describe("idempotency — replay returns the prior response without a second event", () => {
  it("a replayed saveTextDraft key does not mutate twice", async () => {
    const textId = await createTextOk("essay");
    const key = crypto.randomUUID();

    const first = await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "once" }, key),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Same idempotency key + same action: replay the recorded response.
    const replay = await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "twice" }, key),
    );
    expect(replay).toEqual(first);

    const [draft] = await db.select().from(textDraft).where(eq(textDraft.textId, textId));
    expect(draft?.revision).toBe(2); // incremented once, not twice
    expect(draft?.bodyMarkdown).toBe("once"); // the replayed body never applied

    const events = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.idempotencyKey, key), eq(operatorEvent.action, "text.save")));
    expect(events.length).toBe(1);
  });
});

// ── software drafts: destination + primary media validation ───────────────────

describe("saveSoftwareDraft — destination + primary media rules", () => {
  it("accepts https everywhere and rejects non-loopback http / javascript in production", async () => {
    const softwareId = await createSoftwareOk("tool");
    const w = writes("production");
    let rev = 1;
    const next = () => ({ softwareId, expectedRevision: rev });

    const https = await w.saveSoftwareDraft(
      call({ ...next(), destinationUrl: "https://app.example.com" }),
    );
    expect(https.ok).toBe(true);
    rev = 2;

    expect(
      await w.saveSoftwareDraft(call({ ...next(), destinationUrl: "http://evil.example.com" })),
    ).toEqual({ ok: false, error: "invalid_destination" });
    expect(
      await w.saveSoftwareDraft(call({ ...next(), destinationUrl: "javascript:alert(1)" })),
    ).toEqual({ ok: false, error: "invalid_destination" });
    expect(
      await w.saveSoftwareDraft(call({ ...next(), destinationUrl: "http://localhost:3000" })),
    ).toEqual({ ok: false, error: "invalid_destination" });
  });

  it("permits loopback http only in development", async () => {
    const softwareId = await createSoftwareOk("tool");
    const dev = await writes("development").saveSoftwareDraft(
      call({ softwareId, expectedRevision: 1, destinationUrl: "http://localhost:3000/app" }),
    );
    expect(dev.ok).toBe(true);
    const dev2 = await writes("development").saveSoftwareDraft(
      call({ softwareId, expectedRevision: 2, destinationUrl: "http://127.0.0.1:8080" }),
    );
    expect(dev2.ok).toBe(true);
    // A non-loopback http is still rejected in development.
    expect(
      await writes("development").saveSoftwareDraft(
        call({ softwareId, expectedRevision: 3, destinationUrl: "http://example.com" }),
      ),
    ).toEqual({ ok: false, error: "invalid_destination" });
  });

  it("rejects a primaryMediaId not owned by this software", async () => {
    const softwareId = await createSoftwareOk("tool");
    const other = await createSoftwareOk("other");
    await seedReadyMedia("mine", "software", softwareId);
    await seedReadyMedia("theirs", "software", other);

    expect(
      await writes().saveSoftwareDraft(
        call({ softwareId, expectedRevision: 1, primaryMediaId: "theirs" }),
      ),
    ).toEqual({ ok: false, error: "invalid_media" });

    const ok = await writes().saveSoftwareDraft(
      call({ softwareId, expectedRevision: 1, primaryMediaId: "mine" }),
    );
    expect(ok.ok).toBe(true);
  });

  it("clamps the action label and defaults an empty one", async () => {
    const softwareId = await createSoftwareOk("tool");
    await writes().saveSoftwareDraft(
      call({ softwareId, expectedRevision: 1, actionLabel: "  Launch\nthe   thing  " }),
    );
    let [draft] = await db
      .select()
      .from(softwareDraft)
      .where(eq(softwareDraft.softwareId, softwareId));
    expect(draft?.actionLabel).toBe("Launch the thing");

    await writes().saveSoftwareDraft(call({ softwareId, expectedRevision: 2, actionLabel: "   " }));
    [draft] = await db.select().from(softwareDraft).where(eq(softwareDraft.softwareId, softwareId));
    expect(draft?.actionLabel).toBe("Open system");
  });
});

// ── software publish: single snapshot, INV-SW-2 ───────────────────────────────

describe("publishSoftware — one snapshot, public updatedAt, INV-SW-2", () => {
  async function readyToPublish(slug: string): Promise<string> {
    const softwareId = await createSoftwareOk(slug);
    await writes().saveSoftwareDraft(
      call({
        softwareId,
        expectedRevision: 1,
        title: "The Tool",
        deck: "does things",
        whatItIsMarkdown: "a system",
        destinationUrl: "https://app.example.com",
      }),
    );
    return softwareId;
  }

  it("publish creates exactly one publication row and requires no version", async () => {
    const softwareId = await readyToPublish("tool");
    const pub = await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    const pubs = await db
      .select()
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, softwareId));
    expect(pubs.length).toBe(1);
    expect(pubs[0]).not.toHaveProperty("version");
    expect(pubs[0]?.publishedAt).toBe(pub.value.publishedAt);
    expect(pubs[0]?.updatedAt).toBe(pub.value.updatedAt);

    const [entry] = await db.select().from(softwareEntry).where(eq(softwareEntry.id, softwareId));
    expect(entry?.state).toBe("published");
  });

  it("rejects publishing with an invalid/empty destination", async () => {
    const softwareId = await createSoftwareOk("tool"); // draft destination is empty
    expect(await writes().publishSoftware(call({ softwareId, expectedRevision: 1 }))).toEqual({
      ok: false,
      error: "invalid_destination",
    });
  });

  it("rejects publish when the primary media is not ready-owned (missing_media)", async () => {
    const softwareId = await readyToPublish("tool");
    // Point the draft at a media id that has no ready row.
    await db
      .update(softwareDraft)
      .set({ primaryMediaId: "ghost", revision: 3 })
      .where(eq(softwareDraft.softwareId, softwareId));
    const res = await writes().publishSoftware(call({ softwareId, expectedRevision: 3 }));
    expect(res).toEqual({ ok: false, error: "missing_media" });
  });

  it("replaces the single snapshot and bumps public updatedAt; a draft save never touches it (INV-SW-2)", async () => {
    const softwareId = await readyToPublish("tool");
    const first = await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A draft edit must NOT change the public snapshot or its updatedAt.
    await writes().saveSoftwareDraft(
      call({ softwareId, expectedRevision: 2, deck: "edited deck", title: "Edited" }),
    );
    let [pubRow] = await db
      .select()
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, softwareId));
    expect(pubRow?.deck).toBe("does things");
    expect(pubRow?.title).toBe("The Tool");
    expect(pubRow?.updatedAt).toBe(first.value.updatedAt);

    // Republish: the snapshot changes and updatedAt advances, published_at holds.
    const second = await writes().publishSoftware(call({ softwareId, expectedRevision: 3 }));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    [pubRow] = await db
      .select()
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, softwareId));
    expect(pubRow?.deck).toBe("edited deck");
    expect(pubRow?.title).toBe("Edited");
    expect(pubRow?.publishedAt).toBe(first.value.publishedAt); // first publish set it
    expect(second.value.updatedAt).toBeGreaterThanOrEqual(first.value.updatedAt);

    // Still exactly one publication row across republish.
    const all = await db
      .select()
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, softwareId));
    expect(all.length).toBe(1);
  });

  it("replaces the publication media snapshot on republish", async () => {
    const softwareId = await readyToPublish("tool");
    await seedReadyMedia("a", "software", softwareId, 0);
    await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));
    let snap = await db
      .select()
      .from(softwarePublicationMedia)
      .where(eq(softwarePublicationMedia.softwareId, softwareId));
    expect(snap.map((s) => s.mediaId)).toEqual(["a"]);

    await seedReadyMedia("b", "software", softwareId, 1);
    await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));
    snap = await db
      .select()
      .from(softwarePublicationMedia)
      .where(eq(softwarePublicationMedia.softwareId, softwareId));
    expect(snap.map((s) => s.mediaId).sort()).toEqual(["a", "b"]);
  });
});

// ── operator reads ─────────────────────────────────────────────────────────────

describe("operator reads — listTexts / getText / listSoftware / getSoftware", () => {
  it("listTexts returns drafts across states and getText carries releases + tags", async () => {
    const textId = await createTextOk("essay", "Essay");
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, tags: ["t"], bodyMarkdown: "b" }),
    );
    await writes().publishText(call({ textId, expectedRevision: 2, version: "1.0.0" }));

    const list = await writes().listTexts(call({}));
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    const row = list.value.texts.find((t) => t.textId === textId);
    expect(row?.state).toBe("published");
    expect(row?.activeVersion).toBe("1.0.0");
    expect(row?.tags).toEqual(["t"]);

    const detail = await writes().getText(call({ textId }));
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.releases.map((r) => r.version)).toEqual(["1.0.0"]);
    expect(detail.value.draft.activeVersion).toBe("1.0.0");

    expect(await writes().getText(call({ textId: "nope" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("getSoftware returns the draft and the published snapshot", async () => {
    const softwareId = await createSoftwareOk("tool");
    await writes().saveSoftwareDraft(
      call({
        softwareId,
        expectedRevision: 1,
        destinationUrl: "https://app.example.com",
        title: "T",
      }),
    );
    await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));

    const detail = await writes().getSoftware(call({ softwareId }));
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    expect(detail.value.draft.softwareId).toBe(softwareId);
    expect(detail.value.published?.destinationUrl).toBe("https://app.example.com");

    const list = await writes().listSoftware(call({ state: "published" }));
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.software.map((s) => s.softwareId)).toContain(softwareId);
  });

  it("rejects a malformed cursor", async () => {
    expect(await writes().listTexts(call({ cursor: "@@@" }))).toEqual({
      ok: false,
      error: "invalid_cursor",
    });
    expect(await writes().listSoftware(call({ cursor: "@@@" }))).toEqual({
      ok: false,
      error: "invalid_cursor",
    });
  });
});
