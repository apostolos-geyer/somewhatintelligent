/**
 * D1 integration: the `PublisherOperator` PAGE lifecycle (T17) against a REAL
 * local D1, plus a REAL worker-side `StoreCatalog` stub bound over RPC. Proves
 * INV-PAGE-1 (the document validator runs on save, publish, AND read — unknown
 * component/HTML/style/script fields, over-length strings, and wrong-shaped
 * sections are rejected) and INV-DOM-1 (publish resolves `featuredProductId`
 * through the real StoreCatalog binding, `featuredSoftwareId` against Publisher's
 * own published records, and referenced media against page-owned rows, storing
 * only the foreign id — never copying product data). Also proves the publish
 * batch invariants (immutable `page_release` inserted BEFORE the pointer move
 * with the audit event in the SAME batch) and optimistic concurrency.
 *
 * The StoreCatalog stub (see `vitest.pool.config.ts`) is an actual
 * `WorkerEntrypoint` answering `getProductById` from its own D1, seeded here over
 * RPC — the publish path therefore crosses a real service-binding RPC boundary.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import * as schema from "@/schema";
import type { OperatorCall, PageDocumentByKey } from "@si/contracts";
import { validatePageDocument } from "@si/contracts";
import { PublisherOperatorWrites, type PublisherStoreCatalog } from "@/operator/writes";
import { DEFAULT_PAGE_DOCUMENTS } from "@/lib/default-page-documents";

const db = drizzle(env.DB, { schema });

const {
  textEntry,
  softwareEntry,
  publisherMedia,
  publisherReleaseMedia,
  pageEntry,
  pageDraft,
  pageRelease,
  operatorEvent,
} = schema;

const SUB = "op-sub";
const EMAIL = "op@example.com";

// The bound stub, typed to the contract slice Publisher uses plus the test-only
// `seedProduct` RPC. Every call here is real cross-worker RPC.
const storeCatalog = env.STORE as unknown as PublisherStoreCatalog & {
  seedProduct(input: {
    id: string;
    slug: string;
    title: string;
    priceCents?: number;
  }): Promise<{ ok: true; value: { id: string } }>;
};

function writes(): PublisherOperatorWrites {
  return new PublisherOperatorWrites({ db, environment: "production", storeCatalog });
}

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

// ── document builders ─────────────────────────────────────────────────────────

function cloneDefault<K extends keyof typeof DEFAULT_PAGE_DOCUMENTS>(
  key: K,
): (typeof DEFAULT_PAGE_DOCUMENTS)[K] {
  return structuredClone(DEFAULT_PAGE_DOCUMENTS[key]);
}

function homeWith(mut: (d: PageDocumentByKey["home"]) => void): PageDocumentByKey["home"] {
  const d = cloneDefault("home");
  mut(d);
  return d;
}

const homeWithProduct = (id: string | null) =>
  homeWith((d) => {
    d.sections.objects.featuredProductId = id;
  });
const homeWithSoftware = (id: string | null) =>
  homeWith((d) => {
    d.sections.systems.featuredSoftwareId = id;
  });
const homeWithHero = (id: string | null) =>
  homeWith((d) => {
    d.heroMediaId = id;
  });

// ── seed helpers ─────────────────────────────────────────────────────────────

async function createPageOk<K extends keyof typeof DEFAULT_PAGE_DOCUMENTS>(
  key: K,
): Promise<string> {
  const res = await writes().createPage(call({ key, document: cloneDefault(key) }));
  if (!res.ok) throw new Error(`createPage ${key} failed: ${res.error}`);
  return res.value.pageId;
}

async function seedPageMedia(
  id: string,
  pageId: string,
  state: "ready" | "pending" = "ready",
): Promise<void> {
  await db.insert(publisherMedia).values({
    id,
    ownerType: "page",
    ownerId: pageId,
    storageKey: `key-${id}`,
    contentSha256: "a".repeat(64),
    contentType: "image/png",
    sizeBytes: 100,
    width: 800,
    height: 600,
    role: "hero",
    alt: `alt ${id}`,
    position: 0,
    state,
    createdBySub: SUB,
    createdAt: 1,
  });
}

beforeEach(async () => {
  await db.delete(publisherReleaseMedia);
  await db.delete(publisherMedia);
  await db.delete(pageEntry);
  await db.delete(softwareEntry);
  await db.delete(textEntry);
  await db.delete(operatorEvent);
});

// ── the five committed default documents ──────────────────────────────────────

describe("default page documents (T14 seed)", () => {
  it("every committed default validates through the contract validator", () => {
    for (const key of Object.keys(
      DEFAULT_PAGE_DOCUMENTS,
    ) as (keyof typeof DEFAULT_PAGE_DOCUMENTS)[]) {
      const res = validatePageDocument(key, DEFAULT_PAGE_DOCUMENTS[key]);
      expect(res.ok).toBe(true);
    }
  });

  it("every default round-trips through create → publish → read", async () => {
    for (const key of Object.keys(
      DEFAULT_PAGE_DOCUMENTS,
    ) as (keyof typeof DEFAULT_PAGE_DOCUMENTS)[]) {
      const created = await writes().createPage(call({ key, document: cloneDefault(key) }));
      expect(created.ok).toBe(true);

      const published = await writes().publishPage(
        call({ key, expectedRevision: 1, version: "1.0.0" }),
      );
      expect(published.ok).toBe(true);

      const got = await writes().getPage(call({ key }));
      expect(got.ok).toBe(true);
      if (!got.ok) continue;
      expect(got.value.key).toBe(key);
      expect(got.value.activeVersion).toBe("1.0.0");
      expect(got.value.document).toEqual(DEFAULT_PAGE_DOCUMENTS[key]);
    }
  });
});

// ── INV-PAGE-1: validator rejects unauthorized content on save/publish/read ────

describe("document validation — unknown/HTML/style/script fields (INV-PAGE-1)", () => {
  it("savePageDraft rejects unknown component / html / style / script fields", async () => {
    await createPageOk("home");
    const base = DEFAULT_PAGE_DOCUMENTS.home;
    const bad = [
      { ...base, component: "RawHtml" },
      { ...base, html: "<script>alert(1)</script>" },
      { ...base, style: "body{display:none}" },
      { ...base, script: "fetch('/steal')" },
      {
        ...base,
        sections: { ...base.sections, objects: { ...base.sections.objects, script: "x" } },
      },
    ];
    for (const doc of bad) {
      const res = await writes().savePageDraft(
        call({
          key: "home",
          expectedRevision: 1,
          document: doc as unknown as PageDocumentByKey["home"],
        }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("invalid_document");
    }
    // Every rejected save left the draft revision untouched.
    const got = await writes().getPage(call({ key: "home" }));
    expect(got.ok && got.value.revision).toBe(1);
  });

  it("savePageDraft rejects over-length strings and wrong-shaped sections", async () => {
    await createPageOk("home");
    const base = DEFAULT_PAGE_DOCUMENTS.home;
    const overLength = { ...base, tagline: "x".repeat(401) }; // tagline max 400
    const missingField = {
      ...base,
      sections: { ...base.sections, objects: { eyebrow: "OBJECTS", body: "b", actionLabel: "a" } },
    };
    const wrongEyebrow = {
      ...base,
      sections: {
        ...base.sections,
        objects: { ...base.sections.objects, eyebrow: "NOT_OBJECTS" },
      },
    };
    for (const doc of [overLength, missingField, wrongEyebrow]) {
      const res = await writes().savePageDraft(
        call({
          key: "home",
          expectedRevision: 1,
          document: doc as unknown as PageDocumentByKey["home"],
        }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe("invalid_document");
    }
  });

  it("createPage rejects an invalid document", async () => {
    const res = await writes().createPage(
      call({
        key: "shop",
        document: {
          ...DEFAULT_PAGE_DOCUMENTS.shop,
          script: "x",
        } as unknown as PageDocumentByKey["shop"],
      }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("invalid_document");
  });

  it("getPage treats a tampered stored document as not_found (read boundary)", async () => {
    const pageId = await createPageOk("home");
    const tampered = JSON.stringify({ ...DEFAULT_PAGE_DOCUMENTS.home, script: "evil" });
    await db.update(pageDraft).set({ documentJson: tampered }).where(eq(pageDraft.pageId, pageId));
    expect(await writes().getPage(call({ key: "home" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("publishPage refuses a tampered stored draft (publish boundary)", async () => {
    const pageId = await createPageOk("home");
    const tampered = JSON.stringify({ ...DEFAULT_PAGE_DOCUMENTS.home, script: "evil" });
    await db.update(pageDraft).set({ documentJson: tampered }).where(eq(pageDraft.pageId, pageId));
    const res = await writes().publishPage(
      call({ key: "home", expectedRevision: 1, version: "1.0.0" }),
    );
    expect(res.ok).toBe(false);
    const releases = await db.select().from(pageRelease).where(eq(pageRelease.pageId, pageId));
    expect(releases.length).toBe(0);
  });
});

// ── INV-DOM-1: featuredProductId resolves through the REAL StoreCatalog ────────

describe("featured product reference — real StoreCatalog binding (INV-DOM-1)", () => {
  it("publishes when the StoreCatalog resolves the product, storing only the id", async () => {
    await storeCatalog.seedProduct({
      id: "prod-active",
      slug: "tee",
      title: "Tee",
      priceCents: 6800,
    });
    await createPageOk("home");

    const saved = await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithProduct("prod-active") }),
    );
    expect(saved.ok).toBe(true);

    const pub = await writes().publishPage(
      call({ key: "home", expectedRevision: 2, version: "1.0.0" }),
    );
    expect(pub.ok).toBe(true);

    // The document keeps the foreign id verbatim — no product data copied in.
    const got = await writes().getPage(call({ key: "home" as const }));
    expect(got.ok && got.value.document.sections.objects.featuredProductId).toBe("prod-active");
  });

  it("rejects a featuredProductId the StoreCatalog does not resolve (invalid_reference)", async () => {
    await createPageOk("home");
    const saved = await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithProduct("ghost-product") }),
    );
    expect(saved.ok).toBe(true);
    expect(
      await writes().publishPage(call({ key: "home", expectedRevision: 2, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "invalid_reference" });
  });
});

// ── INV-DOM-1: featuredSoftwareId against Publisher's OWN published records ─────

describe("featured software reference — must be published", () => {
  it("rejects unpublished software, then publishes once the software is published", async () => {
    await createPageOk("home");
    const created = await writes().createSoftware(call({ slug: "tool", title: "Tool" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const softwareId = created.value.softwareId;

    await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithSoftware(softwareId) }),
    );
    // Draft (unpublished) software → invalid_reference.
    expect(
      await writes().publishPage(call({ key: "home", expectedRevision: 2, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "invalid_reference" });

    // Publish the software; the page reference now resolves.
    await writes().saveSoftwareDraft(
      call({
        softwareId,
        expectedRevision: 1,
        destinationUrl: "https://app.example.com",
        title: "Tool",
      }),
    );
    const swPub = await writes().publishSoftware(call({ softwareId, expectedRevision: 2 }));
    expect(swPub.ok).toBe(true);

    const pagePub = await writes().publishPage(
      call({ key: "home", expectedRevision: 2, version: "1.0.0" }),
    );
    expect(pagePub.ok).toBe(true);
  });
});

// ── INV-DOM-1: referenced media must be page-owned + snapshotted ───────────────

describe("page media reference — ownership + snapshot", () => {
  it("publishes and snapshots a page-owned media reference", async () => {
    const pageId = await createPageOk("home");
    await seedPageMedia("m-hero", pageId);
    const saved = await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithHero("m-hero") }),
    );
    expect(saved.ok).toBe(true);

    const pub = await writes().publishPage(
      call({ key: "home", expectedRevision: 2, version: "1.0.0" }),
    );
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    // The referenced media is snapshotted so the published page's image is
    // eligible for public delivery via the page release-media join.
    const snap = await db
      .select()
      .from(publisherReleaseMedia)
      .where(
        and(
          eq(publisherReleaseMedia.ownerType, "page"),
          eq(publisherReleaseMedia.releaseId, pub.value.releaseId),
        ),
      );
    expect(snap.map((s) => s.mediaId)).toEqual(["m-hero"]);
  });

  it("rejects a media reference owned by a different page (invalid_reference)", async () => {
    await createPageOk("home");
    const aboutId = await createPageOk("about");
    await seedPageMedia("m-foreign", aboutId); // owned by the ABOUT page

    await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithHero("m-foreign") }),
    );
    expect(
      await writes().publishPage(call({ key: "home", expectedRevision: 2, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "invalid_reference" });
  });

  it("rejects a nonexistent media reference (invalid_reference)", async () => {
    await createPageOk("home");
    await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithHero("does-not-exist") }),
    );
    expect(
      await writes().publishPage(call({ key: "home", expectedRevision: 2, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "invalid_reference" });
  });
});

// ── publish batch: release before pointer + same-batch audit event ─────────────

describe("publishPage — batch ordering + concurrency", () => {
  it("writes the immutable release, moves the pointer, and logs one event", async () => {
    const pageId = await createPageOk("shop");
    const pub = await writes().publishPage(
      call({ key: "shop", expectedRevision: 1, version: "1.0.0" }),
    );
    expect(pub.ok).toBe(true);
    if (!pub.ok) return;

    const [release] = await db
      .select()
      .from(pageRelease)
      .where(eq(pageRelease.id, pub.value.releaseId));
    expect(release?.version).toBe("1.0.0");
    expect(release?.pageId).toBe(pageId);
    // The release carries an immutable snapshot of the published document.
    expect(JSON.parse(release?.documentJson ?? "{}")).toEqual(DEFAULT_PAGE_DOCUMENTS.shop);

    const [entry] = await db.select().from(pageEntry).where(eq(pageEntry.id, pageId));
    expect(entry?.activeReleaseId).toBe(pub.value.releaseId);

    const events = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.targetId, pageId), eq(operatorEvent.action, "page.publish")));
    expect(events.length).toBe(1);
  });

  it("a rejected publish writes neither a release nor an event (atomic batch)", async () => {
    const pageId = await createPageOk("home");
    await writes().savePageDraft(
      call({ key: "home", expectedRevision: 1, document: homeWithProduct("ghost-product") }),
    );
    const res = await writes().publishPage(
      call({ key: "home", expectedRevision: 2, version: "1.0.0" }),
    );
    expect(res.ok).toBe(false);

    const releases = await db.select().from(pageRelease).where(eq(pageRelease.pageId, pageId));
    expect(releases.length).toBe(0);
    const events = await db
      .select()
      .from(operatorEvent)
      .where(and(eq(operatorEvent.targetId, pageId), eq(operatorEvent.action, "page.publish")));
    expect(events.length).toBe(0);
  });

  it("rejects a non-SemVer version, a stale revision, and a duplicate version", async () => {
    await createPageOk("writing");
    expect(
      await writes().publishPage(call({ key: "writing", expectedRevision: 1, version: "v1" })),
    ).toEqual({ ok: false, error: "invalid_version" });
    expect(
      await writes().publishPage(call({ key: "writing", expectedRevision: 99, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "revision_conflict" });

    const first = await writes().publishPage(
      call({ key: "writing", expectedRevision: 1, version: "1.0.0" }),
    );
    expect(first.ok).toBe(true);
    // Republish the same retained version (publish leaves the draft revision).
    expect(
      await writes().publishPage(call({ key: "writing", expectedRevision: 1, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "version_exists" });
  });

  it("publishPage is not_found for an uncreated page", async () => {
    expect(
      await writes().publishPage(call({ key: "about", expectedRevision: 1, version: "1.0.0" })),
    ).toEqual({ ok: false, error: "not_found" });
  });
});

// ── create + save: existence + optimistic concurrency ─────────────────────────

describe("createPage / savePageDraft — existence + optimistic concurrency", () => {
  it("getPage is not_found before creation; createPage rejects a duplicate key", async () => {
    expect(await writes().getPage(call({ key: "home" }))).toEqual({
      ok: false,
      error: "not_found",
    });
    await createPageOk("home");
    const dup = await writes().createPage(call({ key: "home", document: cloneDefault("home") }));
    expect(dup).toEqual({ ok: false, error: "page_exists" });
  });

  it("savePageDraft increments revision and rejects a stale expectedRevision", async () => {
    await createPageOk("about");
    const revised = cloneDefault("about");
    revised.statement = "Revised statement.";
    const saved = await writes().savePageDraft(
      call({ key: "about", expectedRevision: 1, document: revised }),
    );
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(2);

    const stale = cloneDefault("about");
    stale.statement = "should not apply";
    expect(
      await writes().savePageDraft(call({ key: "about", expectedRevision: 1, document: stale })),
    ).toEqual({ ok: false, error: "revision_conflict" });

    const got = await writes().getPage(call({ key: "about" as const }));
    expect(got.ok && got.value.revision).toBe(2);
    expect(got.ok && got.value.document.statement).toBe("Revised statement.");
  });

  it("savePageDraft is not_found for an uncreated page", async () => {
    expect(
      await writes().savePageDraft(
        call({ key: "shop", expectedRevision: 1, document: cloneDefault("shop") }),
      ),
    ).toEqual({ ok: false, error: "not_found" });
  });
});
