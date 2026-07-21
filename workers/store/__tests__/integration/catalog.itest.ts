/**
 * D1 integration for the `StoreCatalog` read layer (RFC-0001 "StoreCatalog RPC"
 * / D3, D4, INV-DOM-1, INV-MEDIA-1) against a REAL local D1. Seeds product /
 * draft / release / variant / image rows directly, then asserts:
 *   • only status='active' products WITH an active immutable release appear;
 *     draft, unavailable, archived, and release-less products do not;
 *   • DTOs source title/price/version/description from the ACTIVE RELEASE,
 *     never the mutable draft; cover + PublicMediaRefs from the frozen release
 *     image set;
 *   • availability flips with CURRENT variant stock (available/sold_out/unavailable);
 *   • `openProductMedia` streams the injected MediaStorage response for
 *     active-release media and 404s for draft-only, cross-product, unrelated,
 *     and unknown ids (the storage port is injected as a stub — no Roadie).
 */
import { createExecutionContext, env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { MediaStorage } from "@/lib/media-storage";
import {
  getActiveProductDetailById,
  getActiveProductDetailBySlug,
  listActiveProductCards,
  openProductMedia,
  resolveOpenableMediaKey,
} from "@/lib/catalog";
import { StoreCatalog } from "@/store-catalog";

const {
  productBase,
  productDraft,
  productRelease,
  productImage,
  productReleaseImage,
  productVariant,
} = schema;
const db = drizzle(env.DB, { schema });

type Status = "draft" | "active" | "unavailable" | "archived";
type Role = "cover" | "gallery" | "evidence";

async function seedProduct(opts: { id: string; slug: string; status: Status; updatedAt?: Date }) {
  const now = opts.updatedAt ?? new Date();
  await db.insert(productBase).values({
    id: opts.id,
    slug: opts.slug,
    status: opts.status,
    createdBySub: "op",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(productDraft).values({
    productId: opts.id,
    revision: 1,
    title: `DRAFT ${opts.id}`, // deliberately different from the release title
    descriptionMarkdown: "draft copy that must never surface",
    priceCents: 999_999,
    updatedBySub: "op",
    updatedAt: now,
  });
}

async function seedRelease(opts: {
  id: string;
  productId: string;
  slug: string;
  title: string;
  priceCents: number;
  version?: string;
  description?: string | null;
  makeActive?: boolean;
}) {
  await db.insert(productRelease).values({
    id: opts.id,
    productId: opts.productId,
    version: opts.version ?? "1.0.0",
    slug: opts.slug,
    title: opts.title,
    descriptionMarkdown: opts.description ?? null,
    priceCents: opts.priceCents,
    publishedBySub: "op",
    publishedAt: new Date(),
  });
  if (opts.makeActive !== false) {
    await db
      .update(productBase)
      .set({ activeReleaseId: opts.id })
      .where(eq(productBase.id, opts.productId));
  }
}

async function seedImage(opts: {
  id: string;
  productId: string;
  role?: Role;
  position?: number;
  state?: "pending" | "ready" | "failed";
}) {
  await db.insert(productImage).values({
    id: opts.id,
    productId: opts.productId,
    storageKey: `store/${opts.productId}/${opts.id}`,
    contentSha256: "a".repeat(64),
    contentType: "image/webp",
    sizeBytes: 1024,
    width: 800,
    height: 600,
    alt: `alt ${opts.id}`,
    role: opts.role ?? "cover",
    position: opts.position ?? 0,
    state: opts.state ?? "ready",
    createdAt: new Date(),
    readyAt: new Date(),
  });
}

async function snapshotImage(opts: {
  releaseId: string;
  imageId: string;
  role?: string;
  position?: number;
}) {
  await db.insert(productReleaseImage).values({
    releaseId: opts.releaseId,
    imageId: opts.imageId,
    role: opts.role ?? "cover",
    alt: `alt ${opts.imageId}`,
    position: opts.position ?? 0,
  });
}

async function seedVariant(opts: { id: string; productId: string; size: string; stock: number }) {
  await db.insert(productVariant).values({
    id: opts.id,
    productId: opts.productId,
    size: opts.size,
    sku: `SKU-${opts.id}`,
    stock: opts.stock,
    createdAt: new Date(),
  });
}

// The common happy case: an active product with an active release, one ready
// cover image snapshotted into that release, and one in-stock variant.
async function publish(opts: {
  id: string;
  slug: string;
  title?: string;
  priceCents?: number;
  version?: string;
  description?: string | null;
  stock?: number;
  withImage?: boolean;
  updatedAt?: Date;
}) {
  await seedProduct({ id: opts.id, slug: opts.slug, status: "active", updatedAt: opts.updatedAt });
  const releaseId = `r-${opts.id}`;
  await seedRelease({
    id: releaseId,
    productId: opts.id,
    slug: opts.slug,
    title: opts.title ?? `Tee ${opts.id}`,
    priceCents: opts.priceCents ?? 3000,
    version: opts.version,
    description: opts.description ?? null,
  });
  if (opts.stock !== undefined) {
    await seedVariant({ id: `v-${opts.id}`, productId: opts.id, size: "M", stock: opts.stock });
  }
  const imageId = `img-${opts.id}`;
  if (opts.withImage !== false) {
    await seedImage({
      id: imageId,
      productId: opts.id,
      role: "cover",
      position: 0,
      state: "ready",
    });
    await snapshotImage({ releaseId, imageId, role: "cover", position: 0 });
  }
  return { releaseId, imageId };
}

// Injectable stub storage ports (no Roadie, no network): the read path is the
// only method StoreCatalog exercises.
const streamingMedia: MediaStorage = {
  put: async () => ({ ok: true, value: { key: "k" } }),
  read: async ({ key }) => ({
    ok: true,
    value: new Response(`bytes:${key}`, { status: 200 }),
  }),
  delete: async () => ({ ok: true, value: undefined }),
};
const missingMedia: MediaStorage = {
  ...streamingMedia,
  read: async () => ({ ok: false, error: "not_found" }),
};

function makeCatalog(media: MediaStorage): StoreCatalog {
  class TestCatalog extends StoreCatalog {
    protected async mediaStorage(): Promise<MediaStorage> {
      return media;
    }
  }
  return new TestCatalog(createExecutionContext(), env as unknown as Env);
}

beforeEach(async () => {
  await db.delete(productBase); // cascades draft / release / image / variant / release-image
});

describe("listProducts — visibility (INV-DOM-1)", () => {
  it("returns active products with an active release and hides everything else", async () => {
    await publish({ id: "p-active", slug: "active-tee", stock: 4 });
    // draft
    await seedProduct({ id: "p-draft", slug: "draft-tee", status: "draft" });
    // archived (still has an active release, but archived status filters it out)
    await publish({ id: "p-arch", slug: "arch-tee", stock: 2 });
    await db.update(productBase).set({ status: "archived" }).where(eq(productBase.id, "p-arch"));
    // unavailable
    await publish({ id: "p-unavail", slug: "unavail-tee", stock: 2 });
    await db
      .update(productBase)
      .set({ status: "unavailable" })
      .where(eq(productBase.id, "p-unavail"));
    // active but NO active release (release exists but pointer never advanced)
    await seedProduct({ id: "p-norel", slug: "norel-tee", status: "active" });
    await seedRelease({
      id: "r-norel",
      productId: "p-norel",
      slug: "norel-tee",
      title: "No Release Tee",
      priceCents: 3000,
      makeActive: false,
    });

    const result = await listActiveProductCards(db, {});
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.products.map((p) => p.id)).toEqual(["p-active"]);
    expect(result.value.nextCursor).toBeNull();
  });

  it("sources the card from the active RELEASE, not the draft", async () => {
    await publish({
      id: "p1",
      slug: "field-tee",
      title: "Field Tee",
      priceCents: 4200,
      version: "2.1.0",
      description: "The **field** tee.\n\nSecond paragraph.",
      stock: 3,
    });

    const result = await listActiveProductCards(db, {});
    if (!result.ok) throw new Error("expected ok");
    const [card] = result.value.products;
    expect(card).toMatchObject({
      id: "p1",
      slug: "field-tee",
      version: "2.1.0",
      title: "Field Tee", // release title, not "DRAFT p1"
      priceCents: 4200, // release price, not the draft's 999_999
      currency: "CAD",
      coverMediaId: "img-p1",
      availability: "available",
      totalStock: 3,
    });
    expect(card!.descriptionExcerpt).toBe("The **field** tee. Second paragraph.");
  });
});

describe("listProducts — availability from CURRENT variant stock", () => {
  it("available with stock, sold_out at zero, unavailable with no variants", async () => {
    await publish({ id: "p-avail", slug: "avail", stock: 5 });
    await publish({ id: "p-sold", slug: "sold", stock: 0 });
    await publish({ id: "p-none", slug: "none" }); // no variant seeded

    const result = await listActiveProductCards(db, {});
    if (!result.ok) throw new Error("expected ok");
    const map = new Map(result.value.products.map((p) => [p.id, p.availability]));
    expect(map.get("p-avail")).toBe("available");
    expect(map.get("p-sold")).toBe("sold_out");
    expect(map.get("p-none")).toBe("unavailable");
  });

  it("flips available → sold_out when stock is drained", async () => {
    await publish({ id: "p1", slug: "tee", stock: 2 });
    const before = await listActiveProductCards(db, {});
    if (!before.ok) throw new Error("expected ok");
    expect(before.value.products[0]!.availability).toBe("available");

    await db.update(productVariant).set({ stock: 0 }).where(eq(productVariant.id, "v-p1"));

    const after = await listActiveProductCards(db, {});
    if (!after.ok) throw new Error("expected ok");
    expect(after.value.products[0]!.availability).toBe("sold_out");
    expect(after.value.products[0]!.totalStock).toBe(0);
  });
});

describe("listProducts — keyset pagination", () => {
  it("pages by (updatedAt desc, id desc) and terminates with a null cursor", async () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    await publish({ id: "p1", slug: "one", stock: 1, updatedAt: new Date(base + 1000) });
    await publish({ id: "p2", slug: "two", stock: 1, updatedAt: new Date(base + 2000) });
    await publish({ id: "p3", slug: "three", stock: 1, updatedAt: new Date(base + 3000) });

    const first = await listActiveProductCards(db, { limit: 2 });
    if (!first.ok) throw new Error("expected ok");
    expect(first.value.products.map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await listActiveProductCards(db, { limit: 2, cursor: first.value.nextCursor! });
    if (!second.ok) throw new Error("expected ok");
    expect(second.value.products.map((p) => p.id)).toEqual(["p1"]);
    expect(second.value.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor with invalid_cursor", async () => {
    const result = await listActiveProductCards(db, { cursor: "not a real cursor !!!" });
    expect(result).toEqual({ ok: false, error: "invalid_cursor" });
  });
});

describe("getProductBySlug / getProductById → ProductDetailDTO | not_found", () => {
  it("returns the active-release detail with sorted variants and frozen media", async () => {
    const { releaseId } = await publish({
      id: "p1",
      slug: "field-tee",
      title: "Field Tee",
      priceCents: 4200,
      description: "Full **markdown** body.",
      stock: 3,
    });
    // a second, non-cover gallery image + variant to exercise ordering
    await seedImage({
      id: "img-gallery",
      productId: "p1",
      role: "gallery",
      position: 1,
      state: "ready",
    });
    await snapshotImage({ releaseId, imageId: "img-gallery", role: "gallery", position: 1 });
    await seedVariant({ id: "v-s", productId: "p1", size: "S", stock: 0 });

    const bySlug = await getActiveProductDetailBySlug(db, "field-tee");
    if (!bySlug.ok) throw new Error("expected ok");
    const detail = bySlug.value;
    expect(detail.title).toBe("Field Tee");
    expect(detail.descriptionMarkdown).toBe("Full **markdown** body.");
    expect(detail.coverMediaId).toBe("img-p1");
    expect(detail.media.map((m) => m.id)).toEqual(["img-p1", "img-gallery"]);
    expect(detail.media[0]).toMatchObject({
      id: "img-p1",
      href: "/api/store/media/img-p1",
      role: "cover",
      position: 0,
      contentType: "image/webp",
      width: 800,
      height: 600,
    });
    // variants sorted by canonical size order (S before M); availability per variant
    expect(detail.variants.map((v) => v.size)).toEqual(["S", "M"]);
    expect(detail.variants.find((v) => v.size === "S")!.available).toBe(false);
    expect(detail.variants.find((v) => v.size === "M")!.available).toBe(true);
    expect(detail.totalStock).toBe(3);

    const byId = await getActiveProductDetailById(db, "p1");
    if (!byId.ok) throw new Error("expected ok");
    expect(byId.value.id).toBe("p1");
  });

  it("only ready images are snapshotted into the public media set", async () => {
    const { releaseId } = await publish({ id: "p1", slug: "tee", stock: 1 });
    // a failed image snapshotted into the release must not appear publicly
    await seedImage({
      id: "img-bad",
      productId: "p1",
      role: "gallery",
      position: 1,
      state: "failed",
    });
    await snapshotImage({ releaseId, imageId: "img-bad", role: "gallery", position: 1 });

    const detail = await getActiveProductDetailBySlug(db, "tee");
    if (!detail.ok) throw new Error("expected ok");
    expect(detail.value.media.map((m) => m.id)).toEqual(["img-p1"]);
  });

  it("not_found for a draft, unknown, or release-less product", async () => {
    await seedProduct({ id: "p-draft", slug: "draft-tee", status: "draft" });
    expect(await getActiveProductDetailBySlug(db, "draft-tee")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await getActiveProductDetailBySlug(db, "does-not-exist")).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await getActiveProductDetailById(db, "nope")).toEqual({ ok: false, error: "not_found" });
  });
});

describe("openProductMedia — INV-MEDIA-1 eligibility gate", () => {
  it("streams the injected storage response for active-release media", async () => {
    await publish({ id: "p1", slug: "tee", stock: 1 });
    const catalog = makeCatalog(streamingMedia);

    const result = await catalog.openProductMedia({ mediaId: "img-p1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toBeInstanceOf(Response);
    // the port's Response is passed through unchanged; key == the private storage_key
    expect(await result.value.text()).toBe("bytes:store/p1/img-p1");
  });

  it("404s a draft-only product's media", async () => {
    // product stays draft: image + release-image exist but the product is not active
    await seedProduct({ id: "p-draft", slug: "draft", status: "draft" });
    await seedRelease({
      id: "r-draft",
      productId: "p-draft",
      slug: "draft",
      title: "Draft",
      priceCents: 3000,
      makeActive: false,
    });
    await seedImage({ id: "img-draft", productId: "p-draft", state: "ready" });
    await snapshotImage({ releaseId: "r-draft", imageId: "img-draft" });

    expect(await resolveOpenableMediaKey(db, "img-draft")).toBeNull();
    const catalog = makeCatalog(streamingMedia);
    expect(await catalog.openProductMedia({ mediaId: "img-draft" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("404s cross-product media not in the requested product's active release", async () => {
    // p1 active with its own release/media; p2 active but img-cross is only a raw
    // product_image on p2 with NO release snapshot → not publicly eligible.
    await publish({ id: "p1", slug: "one", stock: 1 });
    await publish({ id: "p2", slug: "two", stock: 1 });
    await seedImage({
      id: "img-cross",
      productId: "p2",
      role: "gallery",
      position: 5,
      state: "ready",
    });

    expect(await resolveOpenableMediaKey(db, "img-cross")).toBeNull();
    const catalog = makeCatalog(streamingMedia);
    expect(await catalog.openProductMedia({ mediaId: "img-cross" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("404s an unknown media id", async () => {
    const catalog = makeCatalog(streamingMedia);
    expect(await catalog.openProductMedia({ mediaId: "ghost" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("404s when the storage port reports the key missing", async () => {
    await publish({ id: "p1", slug: "tee", stock: 1 });
    const result = await openProductMedia(db, missingMedia, "img-p1");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});
