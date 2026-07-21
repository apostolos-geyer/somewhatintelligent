/**
 * D1 integration: the `PublisherPublic` read core (T15) against a REAL local D1,
 * with an injected `MediaStorage` stub for the delivery path. Proves INV-PUB-1
 * (only active releases / published snapshots surface; drafts and retired
 * records are invisible), INV-MEDIA-1 (only snapshotted media open), the D9.1
 * software `updatedAt` semantics, keyset cursor pagination, and INV-PAGE-1's
 * read-boundary document validation. Runs on the same pool harness as
 * schema.itest.ts (binds only DB; the reads core takes MediaStorage as a dep).
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import type { MediaStorage, StorageResult } from "@/lib/media-storage";
import * as schema from "@/schema";
import { PublisherPublicReads } from "@/public/reads";

const db = drizzle(env.DB, { schema });

const {
  textEntry,
  textRelease,
  textDraft,
  softwareEntry,
  softwarePublication,
  softwareDraft,
  pageEntry,
  pageRelease,
  publisherMedia,
  publisherReleaseMedia,
  softwarePublicationMedia,
  operatorEvent,
} = schema;

const SUB = "op-sub";

// Recording MediaStorage stub: read() logs the storage key it is handed and
// returns a 200 body carrying that key, so a test can prove which key was read.
function recordingMedia(): { media: MediaStorage; readKeys: string[] } {
  const readKeys: string[] = [];
  const media: MediaStorage = {
    async put(): Promise<StorageResult<{ key: string }>> {
      return { ok: false, error: "unavailable" };
    },
    async read({ key }): Promise<StorageResult<Response>> {
      readKeys.push(key);
      return { ok: true, value: new Response(`bytes:${key}`, { status: 200 }) };
    },
    async delete(): Promise<StorageResult<void>> {
      return { ok: false, error: "unavailable" };
    },
  };
  return { media, readKeys };
}

function makeReads(media?: MediaStorage) {
  return new PublisherPublicReads({ db, media: media ?? recordingMedia().media });
}

// ── seed helpers ─────────────────────────────────────────────────────────────

interface PublishTextArgs {
  id: string;
  slug: string;
  version?: string;
  body?: string;
  deck?: string | null;
  tags?: string[];
  publishedAt: number;
  state?: "draft" | "published" | "retired";
  draftBody?: string;
}

async function publishText(args: PublishTextArgs): Promise<string> {
  const releaseId = `${args.id}-rel`;
  await db.insert(textEntry).values({
    id: args.id,
    slug: args.slug,
    state: args.state ?? "published",
    createdBySub: SUB,
    createdAt: args.publishedAt,
    updatedAt: args.publishedAt,
  });
  await db.insert(textRelease).values({
    id: releaseId,
    textId: args.id,
    version: args.version ?? "1.0.0",
    slug: args.slug,
    title: `Title ${args.slug}`,
    deck: args.deck ?? null,
    bodyMarkdown: args.body ?? `Body of ${args.slug}`,
    tagsJson: JSON.stringify(args.tags ?? []),
    publishedBySub: SUB,
    publishedAt: args.publishedAt,
  });
  await db.update(textEntry).set({ activeReleaseId: releaseId }).where(eq(textEntry.id, args.id));
  // A later draft edit that must never leak into the public snapshot.
  await db.insert(textDraft).values({
    textId: args.id,
    revision: 2,
    title: `Title ${args.slug}`,
    bodyMarkdown: args.draftBody ?? `DRAFT edit of ${args.slug}`,
    updatedBySub: SUB,
    updatedAt: args.publishedAt + 10_000,
  });
  return releaseId;
}

interface PublishSoftwareArgs {
  id: string;
  slug: string;
  publicationUpdatedAt: number;
  publishedAt?: number;
  entryUpdatedAt?: number;
  state?: "draft" | "published" | "retired";
  primaryMediaId?: string | null;
  draftUpdatedAt?: number;
}

async function publishSoftware(args: PublishSoftwareArgs): Promise<void> {
  await db.insert(softwareEntry).values({
    id: args.id,
    slug: args.slug,
    state: args.state ?? "published",
    createdBySub: SUB,
    createdAt: args.publishedAt ?? args.publicationUpdatedAt,
    updatedAt: args.entryUpdatedAt ?? args.publicationUpdatedAt,
  });
  await db.insert(softwarePublication).values({
    softwareId: args.id,
    slug: args.slug,
    title: `SW ${args.slug}`,
    deck: `deck ${args.slug}`,
    whatItIsMarkdown: `what ${args.slug}`,
    destinationUrl: "https://example.com/app",
    actionLabel: "Open system",
    primaryMediaId: args.primaryMediaId ?? null,
    publishedBySub: SUB,
    publishedAt: args.publishedAt ?? args.publicationUpdatedAt,
    updatedAt: args.publicationUpdatedAt,
  });
  // A later draft edit with its own timestamp; public updatedAt must ignore it.
  await db.insert(softwareDraft).values({
    softwareId: args.id,
    revision: 2,
    title: `SW ${args.slug} edited`,
    deck: "edited deck",
    whatItIsMarkdown: "edited what",
    destinationUrl: "https://example.com/app",
    actionLabel: "Open system",
    primaryMediaId: args.primaryMediaId ?? null,
    updatedBySub: SUB,
    updatedAt: args.draftUpdatedAt ?? args.publicationUpdatedAt + 50_000,
  });
}

async function addMedia(id: string, ownerType: "text" | "software" | "page", ownerId: string) {
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
    position: 0,
    state: "ready",
    createdBySub: SUB,
    createdAt: 1,
  });
}

function snapshotTextMedia(releaseId: string, mediaId: string, position: number, role = "gallery") {
  return db.insert(publisherReleaseMedia).values({
    ownerType: "text",
    releaseId,
    mediaId,
    role,
    alt: `alt ${mediaId}`,
    position,
  });
}

function snapshotSoftwareMedia(softwareId: string, mediaId: string, position: number) {
  return db.insert(softwarePublicationMedia).values({
    softwareId,
    mediaId,
    role: "gallery",
    alt: `alt ${mediaId}`,
    position,
  });
}

async function seedPage(pageKey: schema.PageEntryRow["pageKey"], documentJson: string) {
  const pageId = `pg-${pageKey}`;
  const releaseId = `${pageId}-rel`;
  await db.insert(pageEntry).values({ id: pageId, pageKey, createdAt: 1, updatedAt: 1 });
  await db.insert(pageRelease).values({
    id: releaseId,
    pageId,
    version: "1.0.0",
    schemaVersion: 1,
    documentJson,
    publishedBySub: SUB,
    publishedAt: 1,
  });
  await db.update(pageEntry).set({ activeReleaseId: releaseId }).where(eq(pageEntry.id, pageId));
}

beforeEach(async () => {
  await db.delete(publisherReleaseMedia);
  await db.delete(softwarePublicationMedia);
  await db.delete(publisherMedia);
  await db.delete(textEntry);
  await db.delete(softwareEntry);
  await db.delete(pageEntry);
  await db.delete(operatorEvent);
});

// ── texts: active release, draft invisibility, retirement ────────────────────

describe("texts — active release only (INV-PUB-1)", () => {
  it("getTextBySlug returns the active release snapshot, not the later draft edit", async () => {
    await publishText({
      id: "t1",
      slug: "essay",
      body: "The published body.",
      deck: "a deck",
      tags: ["philosophy", "essays"],
      publishedAt: 1000,
      draftBody: "A DRAFT rewrite that must stay private.",
    });
    const res = await makeReads().getTextBySlug({ slug: "essay" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.id).toBe("t1");
    expect(res.value.version).toBe("1.0.0");
    expect(res.value.bodyMarkdown).toBe("The published body.");
    expect(res.value.deck).toBe("a deck");
    expect(res.value.tags).toEqual(["philosophy", "essays"]);
    expect(res.value.excerpt).toBe("The published body.");
    expect(res.value.excerpt).not.toContain("DRAFT");
  });

  it("listTexts includes the published text and excludes a retired one", async () => {
    await publishText({ id: "t1", slug: "live", publishedAt: 2000 });
    // Retired but active_release_id still set — the state gate must hide it.
    await publishText({ id: "t2", slug: "gone", publishedAt: 3000, state: "retired" });

    const res = await makeReads().listTexts({});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.texts.map((t) => t.slug)).toEqual(["live"]);

    const retired = await makeReads().getTextBySlug({ slug: "gone" });
    expect(retired).toEqual({ ok: false, error: "not_found" });
  });

  it("getTextBySlug is not_found for an unknown slug", async () => {
    const res = await makeReads().getTextBySlug({ slug: "nope" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("heroMedia is the lowest-position snapshotted media and media is ordered", async () => {
    const releaseId = await publishText({ id: "t1", slug: "withmedia", publishedAt: 1000 });
    await addMedia("m1", "text", "t1");
    await addMedia("m2", "text", "t1");
    await snapshotTextMedia(releaseId, "m2", 1);
    await snapshotTextMedia(releaseId, "m1", 0, "hero");

    const res = await makeReads().getTextBySlug({ slug: "withmedia" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.heroMedia?.id).toBe("m1");
    expect(res.value.heroMedia?.href).toBe("/media/m1");
    expect(res.value.media.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(res.value.media[0]?.contentType).toBe("image/png");
    expect(res.value.media[0]?.width).toBe(800);
  });
});

// ── software: published snapshot + D9.1 updatedAt ─────────────────────────────

describe("software — published snapshot + updatedAt (D9.1, INV-SW-2)", () => {
  it("public updatedAt comes from software_publication.updated_at, not the draft", async () => {
    await publishSoftware({
      id: "s1",
      slug: "tool",
      publicationUpdatedAt: 5000,
      entryUpdatedAt: 1000,
      draftUpdatedAt: 99_999,
    });
    const res = await makeReads().getSoftwareBySlug({ slug: "tool" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.updatedAt).toBe(5000);
    expect(res.value.actionLabel).toBe("Open system");
    expect(res.value.destinationUrl).toBe("https://example.com/app");
  });

  it("primaryMedia resolves the designated snapshot media", async () => {
    await addMedia("sm1", "software", "s1");
    await addMedia("sm2", "software", "s1");
    await publishSoftware({
      id: "s1",
      slug: "tool",
      publicationUpdatedAt: 5000,
      primaryMediaId: "sm2",
    });
    await snapshotSoftwareMedia("s1", "sm1", 0);
    await snapshotSoftwareMedia("s1", "sm2", 1);

    const res = await makeReads().getSoftwareBySlug({ slug: "tool" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.primaryMedia?.id).toBe("sm2");
    expect(res.value.media.map((m) => m.id)).toEqual(["sm1", "sm2"]);
  });

  it("retired software is invisible to list and slug reads", async () => {
    await publishSoftware({ id: "s1", slug: "live", publicationUpdatedAt: 5000 });
    await publishSoftware({ id: "s2", slug: "gone", publicationUpdatedAt: 6000, state: "retired" });

    const list = await makeReads().listSoftware({});
    expect(list.ok).toBe(true);
    if (!list.ok) return;
    expect(list.value.software.map((s) => s.slug)).toEqual(["live"]);

    const retired = await makeReads().getSoftwareBySlug({ slug: "gone" });
    expect(retired).toEqual({ ok: false, error: "not_found" });
  });
});

// ── media eligibility (INV-MEDIA-1) ──────────────────────────────────────────

describe("openPublishedMedia — snapshot eligibility (INV-MEDIA-1)", () => {
  it("opens media snapshotted by an active text release and reads via the port", async () => {
    const releaseId = await publishText({ id: "t1", slug: "essay", publishedAt: 1000 });
    await addMedia("m1", "text", "t1");
    await snapshotTextMedia(releaseId, "m1", 0);

    const { media, readKeys } = recordingMedia();
    const res = await makeReads(media).openPublishedMedia({ mediaId: "m1" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toBeInstanceOf(Response);
    expect(res.value.status).toBe(200);
    // The private storage_key — not the domain id — is what reaches the port.
    expect(readKeys).toEqual(["key-m1"]);
  });

  it("returns not_found for a media that exists only on the draft (never snapshotted)", async () => {
    await publishText({ id: "t1", slug: "essay", publishedAt: 1000 });
    await addMedia("m_draft", "text", "t1"); // publisher_media row, no release_media snapshot

    const { media, readKeys } = recordingMedia();
    const res = await makeReads(media).openPublishedMedia({ mediaId: "m_draft" });
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(readKeys).toEqual([]); // the port is never consulted for ineligible media
  });

  it("returns not_found for media snapshotted by a retired text's release", async () => {
    const releaseId = await publishText({
      id: "t1",
      slug: "gone",
      publishedAt: 1000,
      state: "retired",
    });
    await addMedia("m1", "text", "t1");
    await snapshotTextMedia(releaseId, "m1", 0);

    const res = await makeReads().openPublishedMedia({ mediaId: "m1" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("opens media snapshotted by a published software record", async () => {
    await addMedia("sm1", "software", "s1");
    await publishSoftware({
      id: "s1",
      slug: "tool",
      publicationUpdatedAt: 5000,
      primaryMediaId: "sm1",
    });
    await snapshotSoftwareMedia("s1", "sm1", 0);

    const { media, readKeys } = recordingMedia();
    const res = await makeReads(media).openPublishedMedia({ mediaId: "sm1" });
    expect(res.ok).toBe(true);
    expect(readKeys).toEqual(["key-sm1"]);
  });

  it("returns not_found for an unknown media id", async () => {
    const res = await makeReads().openPublishedMedia({ mediaId: "does-not-exist" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found when the storage port reports the bytes gone", async () => {
    const releaseId = await publishText({ id: "t1", slug: "essay", publishedAt: 1000 });
    await addMedia("m1", "text", "t1");
    await snapshotTextMedia(releaseId, "m1", 0);

    const goneMedia: MediaStorage = {
      async put() {
        return { ok: false, error: "unavailable" };
      },
      async read() {
        return { ok: false, error: "not_found" };
      },
      async delete() {
        return { ok: false, error: "unavailable" };
      },
    };
    const res = await makeReads(goneMedia).openPublishedMedia({ mediaId: "m1" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });
});

// ── cursor pagination ────────────────────────────────────────────────────────

describe("listTexts — keyset cursor pagination", () => {
  it("pages through published texts with a stable nextCursor", async () => {
    // published_at 100..500 → newest-first order t5,t4,t3,t2,t1.
    for (let i = 1; i <= 5; i++) {
      await publishText({ id: `t${i}`, slug: `s${i}`, publishedAt: i * 100 });
    }
    const reads = makeReads();

    const page1 = await reads.listTexts({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.texts.map((t) => t.slug)).toEqual(["s5", "s4"]);
    expect(page1.value.nextCursor).not.toBeNull();

    const page2 = await reads.listTexts({ limit: 2, cursor: page1.value.nextCursor! });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.texts.map((t) => t.slug)).toEqual(["s3", "s2"]);

    const page3 = await reads.listTexts({ limit: 2, cursor: page2.value.nextCursor! });
    expect(page3.ok).toBe(true);
    if (!page3.ok) return;
    expect(page3.value.texts.map((t) => t.slug)).toEqual(["s1"]);
    expect(page3.value.nextCursor).toBeNull();
  });

  it("filters by tag against the release snapshot", async () => {
    await publishText({ id: "t1", slug: "a", publishedAt: 100, tags: ["philosophy"] });
    await publishText({ id: "t2", slug: "b", publishedAt: 200, tags: ["essays"] });
    const res = await makeReads().listTexts({ tag: "philosophy" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.texts.map((t) => t.slug)).toEqual(["a"]);
  });

  it("rejects a malformed cursor with invalid_cursor", async () => {
    const res = await makeReads().listTexts({ cursor: "@@@not-base64@@@" });
    expect(res).toEqual({ ok: false, error: "invalid_cursor" });
  });
});

describe("listSoftware — keyset cursor pagination", () => {
  it("orders by publication updatedAt desc and pages", async () => {
    for (let i = 1; i <= 3; i++) {
      await publishSoftware({ id: `s${i}`, slug: `sw${i}`, publicationUpdatedAt: i * 100 });
    }
    const reads = makeReads();
    const page1 = await reads.listSoftware({ limit: 2 });
    expect(page1.ok).toBe(true);
    if (!page1.ok) return;
    expect(page1.value.software.map((s) => s.slug)).toEqual(["sw3", "sw2"]);
    expect(page1.value.nextCursor).not.toBeNull();

    const page2 = await reads.listSoftware({ limit: 2, cursor: page1.value.nextCursor! });
    expect(page2.ok).toBe(true);
    if (!page2.ok) return;
    expect(page2.value.software.map((s) => s.slug)).toEqual(["sw1"]);
    expect(page2.value.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor with invalid_cursor", async () => {
    const res = await makeReads().listSoftware({ cursor: "%%%" });
    expect(res).toEqual({ ok: false, error: "invalid_cursor" });
  });
});

// ── page read-boundary validation (INV-PAGE-1) ───────────────────────────────

describe("getPage — read-boundary document validation (INV-PAGE-1)", () => {
  const validWriting = JSON.stringify({
    schemaVersion: 1,
    key: "writing",
    seo: { title: "Writing", description: "Essays", imageMediaId: null },
    eyebrow: "TEXTS",
    title: "Writing",
    deck: "Long-form work.",
    emptyMessage: "Nothing yet.",
  });

  it("returns the validated document for a well-formed active release", async () => {
    await seedPage("writing", validWriting);
    const res = await makeReads().getPage({ key: "writing" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.key).toBe("writing");
    expect(res.value.version).toBe("1.0.0");
    expect(res.value.document.title).toBe("Writing");
  });

  it("treats a tampered document (undeclared field) as not_found", async () => {
    const tampered = JSON.stringify({
      schemaVersion: 1,
      key: "shop",
      seo: { title: "Shop", description: "Objects", imageMediaId: null },
      eyebrow: "OBJECTS",
      title: "Shop",
      deck: "Objects for sale.",
      emptyMessage: "Nothing yet.",
      evil: "<script>alert(1)</script>",
    });
    await seedPage("shop", tampered);
    const res = await makeReads().getPage({ key: "shop" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("treats non-JSON document bytes as not_found", async () => {
    await seedPage("about", "this is not json {");
    const res = await makeReads().getPage({ key: "about" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  it("returns not_found for a page with no active release", async () => {
    // Entry exists but active_release_id stays null.
    await db
      .insert(pageEntry)
      .values({ id: "pg-home", pageKey: "home", createdAt: 1, updatedAt: 1 });
    const res = await makeReads().getPage({ key: "home" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });
});
