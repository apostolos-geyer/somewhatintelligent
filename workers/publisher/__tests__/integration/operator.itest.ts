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
import { PublisherPublicReads } from "@/public/reads";
import type { MediaStorage } from "@/lib/media-storage";
import { DEFAULT_PAGE_DOCUMENTS } from "@/lib/default-page-documents";

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
  pageEntry,
  pageRelease,
  operatorEvent,
  operatorDeletionIntent,
  mediaGcOutbox,
} = schema;

const SUB = "op-sub";
const EMAIL = "op@example.com";

// T16 exercises no page publish, so a StoreCatalog that resolves nothing is
// sufficient here; the page-reference path is covered by pages.itest.ts.
const notFoundStoreCatalog = {
  async getProductById(): Promise<{ ok: false; error: "not_found" }> {
    return { ok: false, error: "not_found" };
  },
};

function writes(environment = "production"): PublisherOperatorWrites {
  return new PublisherOperatorWrites({ db, environment, storeCatalog: notFoundStoreCatalog });
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

// A media adapter whose read() always succeeds — public eligibility for a media
// id turns on the DB snapshot join, not the byte read, so this lets
// openPublishedMedia return ok while the media is snapshotted by an active
// release and not_found once the row is gone.
const okMedia: MediaStorage = {
  async put() {
    return { ok: true, value: { key: "k" } };
  },
  async read() {
    return { ok: true, value: new Response("bytes") };
  },
  async delete() {
    return { ok: true, value: undefined };
  },
};

function reads(): PublisherPublicReads {
  return new PublisherPublicReads({ db, media: okMedia });
}

async function seedReadyMedia(
  id: string,
  ownerType: "text" | "software" | "page",
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
  await db.delete(pageEntry);
  await db.delete(tag);
  await db.delete(operatorEvent);
  await db.delete(operatorDeletionIntent);
  await db.delete(mediaGcOutbox);
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

// ── hard-delete (T18) ─────────────────────────────────────────────────────────

async function publishTextVersion(
  textId: string,
  version: string,
  expectedRevision: number,
): Promise<{ releaseId: string; version: string; publishedAt: number }> {
  const res = await writes().publishText(call({ textId, expectedRevision, version }));
  if (!res.ok) throw new Error(`publishText failed: ${res.error}`);
  return res.value;
}

async function createAboutPage(): Promise<string> {
  const doc = structuredClone(DEFAULT_PAGE_DOCUMENTS.about);
  const res = await writes().createPage(call({ key: "about", document: doc }));
  if (!res.ok) throw new Error(`createPage failed: ${res.error}`);
  return res.value.pageId;
}

async function publishAbout(
  version: string,
  expectedRevision: number,
): Promise<{ releaseId: string; version: string; publishedAt: number }> {
  const res = await writes().publishPage(call({ key: "about", expectedRevision, version }));
  if (!res.ok) throw new Error(`publishPage failed: ${res.error}`);
  return res.value;
}

// A confirm call authored by a DIFFERENT operator than the plan.
function confirmAs(token: string, sub: string): OperatorCall<{ confirmationToken: string }> {
  return {
    input: { confirmationToken: token },
    meta: {
      actor: { sub, email: `${sub}@example.com` },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    },
  };
}

describe("deletion plans — impact accuracy + bound token", () => {
  it("planTextReleaseDeletion reports the active release + snapshot media counts", async () => {
    const textId = await createTextOk("essay");
    await seedReadyMedia("m1", "text", textId, 0);
    const pub = await publishTextVersion(textId, "1.0.0", 1);

    const plan = await writes().planTextReleaseDeletion(call({ textId, releaseId: pub.releaseId }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const imp = plan.value.impact;
    expect(imp.targetType).toBe("text_release");
    expect(imp.targetId).toBe(pub.releaseId);
    expect(imp.activeReleaseAffected).toBe(true);
    expect(imp.deleteCounts).toEqual({ releases: 1, releaseMedia: 1 });
    expect(imp.warnings.some((w) => /returns this text to draft/.test(w))).toBe(true);
    expect(plan.value.confirmationToken.length).toBeGreaterThan(0);
    expect(plan.value.expiresAt).toBeGreaterThan(Date.now());

    // The stored intent keeps a HASH, never the clear token.
    const intents = await db.select().from(operatorDeletionIntent);
    expect(intents.length).toBe(1);
    expect(intents[0]?.tokenHash).not.toBe(plan.value.confirmationToken);
    expect(intents[0]?.action).toBe("textRelease.deletePlan");
  });

  it("planTextReleaseDeletion rejects a replacement from another aggregate or the target", async () => {
    const a = await createTextOk("a");
    const b = await createTextOk("b");
    const ra = await publishTextVersion(a, "1.0.0", 1);
    const rb = await publishTextVersion(b, "1.0.0", 1);

    expect(
      await writes().planTextReleaseDeletion(
        call({ textId: a, releaseId: ra.releaseId, replacementReleaseId: rb.releaseId }),
      ),
    ).toEqual({ ok: false, error: "invalid_replacement" });
    expect(
      await writes().planTextReleaseDeletion(
        call({ textId: a, releaseId: ra.releaseId, replacementReleaseId: ra.releaseId }),
      ),
    ).toEqual({ ok: false, error: "invalid_replacement" });
  });

  it("planTextDeletion counts releases, media, tags, wikilinks + inbound dangling", async () => {
    const target = await createTextOk("target");
    const from = await createTextOk("from");
    await writes().saveTextDraft(
      call({ textId: target, expectedRevision: 1, tags: ["a", "b"], bodyMarkdown: "[[from]]" }),
    );
    await writes().saveTextDraft(
      call({ textId: from, expectedRevision: 1, bodyMarkdown: "[[target]]" }),
    );
    await seedReadyMedia("tm", "text", target);
    await publishTextVersion(target, "1.0.0", 2);

    const plan = await writes().planTextDeletion(call({ textId: target }));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const imp = plan.value.impact;
    expect(imp.targetType).toBe("text");
    expect(imp.deleteCounts.releases).toBe(1);
    expect(imp.deleteCounts.media).toBe(1);
    expect(imp.deleteCounts.tagLinks).toBe(2);
    expect(imp.deleteCounts.wikilinks).toBe(1);
    expect(imp.retainedCounts.inboundWikilinks).toBe(1);
    expect(imp.activeReleaseAffected).toBe(true);
  });

  it("planSoftwareDeletion / planTagDeletion / planPageDeletion / planMediaDeletion are not_found for unknown ids", async () => {
    expect(await writes().planSoftwareDeletion(call({ softwareId: "nope" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await writes().planTagDeletion(call({ tagId: "nope" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await writes().planPageDeletion(call({ key: "about" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await writes().planMediaDeletion(call({ mediaId: "nope" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("deletion confirm — every DeletionError path", () => {
  it("an unknown token is not_found", async () => {
    await createTextOk("essay");
    expect(await writes().deleteText(call({ confirmationToken: "deadbeef" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("an expired plan is deletion_plan_expired", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    await db.update(operatorDeletionIntent).set({ expiresAt: Date.now() - 1 });
    expect(
      await writes().deleteText(call({ confirmationToken: plan.value.confirmationToken })),
    ).toEqual({ ok: false, error: "deletion_plan_expired" });
  });

  it("a consumed plan reused with a fresh key is deletion_already_executed", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    const first = await writes().deleteText(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(first.ok).toBe(true);
    // Fresh idempotency key + same (now-consumed) token → single-use guard.
    expect(
      await writes().deleteText(call({ confirmationToken: plan.value.confirmationToken })),
    ).toEqual({ ok: false, error: "deletion_already_executed" });
  });

  it("dependency-graph drift after planning is deletion_plan_mismatch", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    // Publish a release → the re-derived impact no longer matches the plan hash.
    await writes().publishText(call({ textId, expectedRevision: 1, version: "1.0.0" }));
    expect(
      await writes().deleteText(call({ confirmationToken: plan.value.confirmationToken })),
    ).toEqual({ ok: false, error: "deletion_plan_mismatch" });
  });

  it("a token minted for another operator is not usable", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    expect(await writes().deleteText(confirmAs(plan.value.confirmationToken, "intruder"))).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("a token minted for a different action cannot drive another delete", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    // A text-aggregate plan token cannot confirm a text-release deletion.
    expect(
      await writes().deleteTextRelease(call({ confirmationToken: plan.value.confirmationToken })),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

describe("text release deletion — pointer + state transitions (D8)", () => {
  it("deleting the active release without replacement returns the text to draft, pointer NULL", async () => {
    const textId = await createTextOk("essay");
    const pub = await publishTextVersion(textId, "1.0.0", 1);
    const plan = await writes().planTextReleaseDeletion(call({ textId, releaseId: pub.releaseId }));
    if (!plan.ok) return;

    const res = await writes().deleteTextRelease(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(res).toEqual({ ok: true, value: { deleted: true, activeVersion: null } });

    const [entry] = await db.select().from(textEntry).where(eq(textEntry.id, textId));
    expect(entry?.activeReleaseId).toBeNull();
    expect(entry?.state).toBe("draft");
    expect(
      (await db.select().from(textRelease).where(eq(textRelease.id, pub.releaseId))).length,
    ).toBe(0);
  });

  it("deleting the active release with a replacement repoints and stays published", async () => {
    const textId = await createTextOk("essay");
    const v1 = await publishTextVersion(textId, "1.0.0", 1);
    const v2 = await publishTextVersion(textId, "2.0.0", 1);
    const plan = await writes().planTextReleaseDeletion(
      call({ textId, releaseId: v2.releaseId, replacementReleaseId: v1.releaseId }),
    );
    if (!plan.ok) return;

    const res = await writes().deleteTextRelease(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(res).toEqual({ ok: true, value: { deleted: true, activeVersion: "1.0.0" } });

    const [entry] = await db.select().from(textEntry).where(eq(textEntry.id, textId));
    expect(entry?.activeReleaseId).toBe(v1.releaseId);
    expect(entry?.state).toBe("published");
  });
});

describe("page release deletion — public read 404s after pointer clears", () => {
  it("deleting the active page release clears the pointer and public getPage is not_found", async () => {
    await createAboutPage();
    const rel = await publishAbout("1.0.0", 1);
    expect((await reads().getPage({ key: "about" })).ok).toBe(true);

    const plan = await writes().planPageReleaseDeletion(
      call({ key: "about", releaseId: rel.releaseId }),
    );
    if (!plan.ok) return;
    const res = await writes().deletePageRelease(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(res).toEqual({ ok: true, value: { deleted: true, activeVersion: null } });

    const [entry] = await db.select().from(pageEntry).where(eq(pageEntry.pageKey, "about"));
    expect(entry?.activeReleaseId).toBeNull();
    expect(await reads().getPage({ key: "about" })).toEqual({ ok: false, error: "not_found" });
  });
});

describe("tag deletion leaves tagged texts intact", () => {
  it("removes the tag + its links but the text still reads", async () => {
    const textId = await createTextOk("essay");
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, tags: ["philosophy"], bodyMarkdown: "body" }),
    );
    const [tagRow] = await db.select().from(tag);
    expect(tagRow).toBeDefined();

    const plan = await writes().planTagDeletion(call({ tagId: tagRow!.id }));
    if (!plan.ok) return;
    expect(plan.value.impact.deleteCounts).toEqual({ tags: 1, tagLinks: 1 });
    expect(plan.value.impact.warnings.some((w) => /remain unchanged/.test(w))).toBe(true);

    const res = await writes().deleteTag(call({ confirmationToken: plan.value.confirmationToken }));
    expect(res).toEqual({ ok: true, value: { deleted: true } });
    expect((await db.select().from(tag)).length).toBe(0);
    expect((await db.select().from(textTag)).length).toBe(0);
    const [entry] = await db.select().from(textEntry).where(eq(textEntry.id, textId));
    expect(entry?.id).toBe(textId);
    expect((await writes().getText(call({ textId }))).ok).toBe(true);
  });
});

describe("software deletion removes publications + queues media GC", () => {
  it("deletes entry/draft/publication/media snapshots and enqueues the storage key", async () => {
    const softwareId = await createSoftwareOk("tool");
    await writes().saveSoftwareDraft(
      call({ softwareId, expectedRevision: 1, destinationUrl: "https://app.example.com" }),
    );
    await seedReadyMedia("sm", "software", softwareId);
    await writes().saveSoftwareDraft(
      call({ softwareId, expectedRevision: 2, primaryMediaId: "sm" }),
    );
    const pub = await writes().publishSoftware(call({ softwareId, expectedRevision: 3 }));
    expect(pub.ok).toBe(true);

    const plan = await writes().planSoftwareDeletion(call({ softwareId }));
    if (!plan.ok) return;
    expect(plan.value.impact.deleteCounts.publications).toBe(1);
    expect(plan.value.impact.deleteCounts.media).toBe(1);

    const res = await writes().deleteSoftware(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(res).toEqual({ ok: true, value: { deleted: true } });
    expect(
      (await db.select().from(softwareEntry).where(eq(softwareEntry.id, softwareId))).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(softwarePublication)
          .where(eq(softwarePublication.softwareId, softwareId))
      ).length,
    ).toBe(0);
    expect(
      (
        await db
          .select()
          .from(softwarePublicationMedia)
          .where(eq(softwarePublicationMedia.softwareId, softwareId))
      ).length,
    ).toBe(0);
    const gc = await db.select().from(mediaGcOutbox);
    expect(gc.map((g) => g.storageKey)).toContain("key-sm");
  });
});

describe("media deletion — GC outbox + immediate public ineligibility", () => {
  it("deletes an actively-referenced media, 404s the public read, and enqueues GC", async () => {
    const textId = await createTextOk("essay");
    await seedReadyMedia("m1", "text", textId);
    await publishTextVersion(textId, "1.0.0", 1);
    // Snapshotted into the published text's active release → publicly eligible.
    expect((await reads().openPublishedMedia({ mediaId: "m1" })).ok).toBe(true);

    const plan = await writes().planMediaDeletion(call({ mediaId: "m1" }));
    if (!plan.ok) return;
    expect(plan.value.impact.targetType).toBe("media");
    expect(plan.value.impact.activeReleaseAffected).toBe(true);
    expect(plan.value.impact.deleteCounts.media).toBe(1);

    const res = await writes().deleteMedia(
      call({ confirmationToken: plan.value.confirmationToken }),
    );
    expect(res).toEqual({ ok: true, value: { deleted: true } });
    expect(await reads().openPublishedMedia({ mediaId: "m1" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await db.select().from(mediaGcOutbox)).map((g) => g.storageKey)).toContain("key-m1");
    expect(
      (await db.select().from(publisherReleaseMedia).where(eq(publisherReleaseMedia.mediaId, "m1")))
        .length,
    ).toBe(0);
  });
});

describe("deletion audit tombstone is compact", () => {
  it("records identifiers + counts but never bodies", async () => {
    const textId = await createTextOk("essay");
    await writes().saveTextDraft(
      call({ textId, expectedRevision: 1, bodyMarkdown: "SECRET-BODY-TEXT" }),
    );
    await publishTextVersion(textId, "1.0.0", 2);
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    expect(
      (await writes().deleteText(call({ confirmationToken: plan.value.confirmationToken }))).ok,
    ).toBe(true);

    const [event] = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.action, "text.delete"), eq(operatorEvent.targetId, textId)));
    expect(event).toBeDefined();
    expect(event?.detailJson).not.toBeNull();
    const detail = JSON.parse(event!.detailJson!) as { deleteCounts: Record<string, number> };
    expect(detail.deleteCounts.releases).toBe(1);
    expect(event!.detailJson!).not.toContain("SECRET-BODY-TEXT");
    expect(event!.responseJson ?? "").not.toContain("SECRET-BODY-TEXT");
  });
});

describe("deletion idempotency — replay is separate from single-use", () => {
  it("a replayed delete key returns the prior response without a second event", async () => {
    const textId = await createTextOk("essay");
    const plan = await writes().planTextDeletion(call({ textId }));
    if (!plan.ok) return;
    const key = crypto.randomUUID();

    const first = await writes().deleteText(
      call({ confirmationToken: plan.value.confirmationToken }, key),
    );
    expect(first).toEqual({ ok: true, value: { deleted: true } });

    // Same idempotency key: the recorded response replays (not the consumed-token
    // path), and no second event is written.
    const replay = await writes().deleteText(
      call({ confirmationToken: plan.value.confirmationToken }, key),
    );
    expect(replay).toEqual(first);
    const events = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.idempotencyKey, key), eq(operatorEvent.action, "text.delete")));
    expect(events.length).toBe(1);
  });
});
