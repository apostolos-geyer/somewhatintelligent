/**
 * D1 integration for the `StoreOperator` mutation RPC (RFC-0001 "StoreOperator
 * RPC" / D3, D8, D13) against a REAL local D1. Drives the entrypoint end-to-end
 * — this.env.DB is the same miniflare D1 the helpers seed into — and asserts the
 * load-bearing invariants:
 *   • draft optimistic concurrency (revision_conflict), slug/price validation;
 *   • publish requires ≥1 ready image + ≥1 variant, SNAPSHOTS ready images into
 *     product_release_image in the SAME batch, and NEVER mutates stock (INV-REL-1);
 *   • one idempotent store_operator_event per success — a replayed idempotency
 *     key returns the prior result without re-mutating (INV-AUDIT-1);
 *   • stock adjust cannot go negative (INV-STOCK-1);
 *   • order transitions reject shipping an unpaid order and reactivating a
 *     cancelled one; setProductStatus release rules.
 */
import { createExecutionContext, env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { OperatorCall } from "@si/contracts";
import { StoreOperator } from "@/store-operator";
import { seedOrder, seedOrderItem } from "./helpers";

const {
  productBase,
  productImage,
  productReleaseImage,
  productVariant,
  customerOrder,
  orderItem,
  storeOperatorEvent,
} = schema;
const db = drizzle(env.DB, { schema });

function operator(): StoreOperator {
  return new StoreOperator(createExecutionContext(), env as unknown as Env);
}

// A distinct idempotency key per call unless an explicit action+commandId is
// pinned (to exercise replay). `meta` is what OPERATOR constructs after Access.
let seq = 0;
function call<T>(
  input: T,
  opts?: { action?: string; commandId?: string; sub?: string },
): OperatorCall<T> {
  const sub = opts?.sub ?? "op-1";
  const action = opts?.action ?? `act-${++seq}`;
  const commandId = opts?.commandId ?? `cmd-${++seq}`;
  return {
    input,
    meta: {
      actor: { sub, email: `${sub}@desk` },
      requestId: `req-${++seq}`,
      idempotencyKey: `${sub}:${action}:${commandId}`,
    },
  };
}

async function seedImage(opts: {
  id: string;
  productId: string;
  state?: "pending" | "ready" | "failed";
  role?: "cover" | "gallery" | "evidence";
  position?: number;
}) {
  const state = opts.state ?? "ready";
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
    role: opts.role ?? "gallery",
    position: opts.position ?? 0,
    state,
    createdAt: new Date(),
    readyAt: state === "ready" ? new Date() : null,
  });
}

async function createDraft(slug: string, priceCents = 3000, title = "Tee"): Promise<string> {
  const res = await operator().createProduct(call({ slug, title, priceCents }));
  if (!res.ok) throw new Error(`createProduct failed: ${res.error}`);
  return res.value.productId;
}

/** A draft product with one ready cover image and one in-stock variant — ready
 *  to publish 1.0.0 at draft revision 1. */
async function makePublishable(slug: string, stock = 5): Promise<string> {
  const id = await createDraft(slug);
  await seedImage({ id: `img-${slug}`, productId: id, state: "ready", role: "cover", position: 0 });
  const v = await operator().putVariant(
    call({ productId: id, size: "M", sku: `${slug}-M`, stock }),
  );
  if (!v.ok) throw new Error(`putVariant failed: ${v.error}`);
  return id;
}

async function events() {
  return db.select().from(storeOperatorEvent);
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(storeOperatorEvent);
  await db.delete(productBase); // cascades draft / release / image / variant / release-image
});

describe("createProduct", () => {
  it("creates a draft product at revision 1 and records one event", async () => {
    const res = await operator().createProduct(
      call({ slug: "field-tee", title: "Field Tee", priceCents: 4200 }),
    );
    if (!res.ok) throw new Error("expected ok");
    expect(res.value.revision).toBe(1);
    const [prod] = await db
      .select()
      .from(productBase)
      .where(eq(productBase.id, res.value.productId));
    expect(prod!.status).toBe("draft");
    expect(await events()).toHaveLength(1);
  });

  it("rejects a negative price and a duplicate slug", async () => {
    expect(await operator().createProduct(call({ slug: "a", title: "A", priceCents: -1 }))).toEqual(
      {
        ok: false,
        error: "invalid_price",
      },
    );
    await createDraft("taken");
    expect(
      await operator().createProduct(call({ slug: "taken", title: "Dup", priceCents: 100 })),
    ).toEqual({
      ok: false,
      error: "slug_taken",
    });
  });

  it("replays an idempotency key without a second mutation (INV-AUDIT-1)", async () => {
    const c = call(
      { slug: "once", title: "Once", priceCents: 100 },
      { action: "createProduct", commandId: "k1" },
    );
    const first = await operator().createProduct(c);
    const second = await operator().createProduct(c);
    expect(second).toEqual(first);
    expect(await db.select().from(productBase)).toHaveLength(1);
    expect(await events()).toHaveLength(1);
  });
});

describe("saveProductDraft — optimistic concurrency", () => {
  it("bumps the revision on save and rejects a stale expectedRevision", async () => {
    const id = await createDraft("tee");
    const ok = await operator().saveProductDraft(
      call({ productId: id, expectedRevision: 1, title: "Renamed", priceCents: 5000 }),
    );
    if (!ok.ok) throw new Error("expected ok");
    expect(ok.value.revision).toBe(2);

    // A second tab still holding revision 1 loses.
    const stale = await operator().saveProductDraft(
      call({ productId: id, expectedRevision: 1, title: "Clobber" }),
    );
    expect(stale).toEqual({ ok: false, error: "revision_conflict" });
    const [draft] = await db
      .select()
      .from(schema.productDraft)
      .where(eq(schema.productDraft.productId, id));
    expect(draft!.title).toBe("Renamed"); // never clobbered
    expect(draft!.revision).toBe(2);
  });

  it("enforces slug uniqueness and non-negative price", async () => {
    const id = await createDraft("keep");
    await createDraft("other");
    expect(
      await operator().saveProductDraft(
        call({ productId: id, expectedRevision: 1, slug: "other" }),
      ),
    ).toEqual({
      ok: false,
      error: "slug_taken",
    });
    expect(
      await operator().saveProductDraft(
        call({ productId: id, expectedRevision: 1, priceCents: -5 }),
      ),
    ).toEqual({
      ok: false,
      error: "invalid_price",
    });
    expect(
      await operator().saveProductDraft(call({ productId: "ghost", expectedRevision: 1 })),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("publishProduct", () => {
  it("requires at least one ready image and one variant", async () => {
    const bare = await createDraft("bare");
    expect(
      await operator().publishProduct(
        call({ productId: bare, expectedRevision: 1, version: "1.0.0" }),
      ),
    ).toEqual({
      ok: false,
      error: "missing_media",
    });
    await seedImage({ id: "img-bare", productId: bare, state: "ready" });
    expect(
      await operator().publishProduct(
        call({ productId: bare, expectedRevision: 1, version: "1.0.0" }),
      ),
    ).toEqual({
      ok: false,
      error: "missing_variant",
    });
  });

  it("rejects a non-SemVer version and a stale revision", async () => {
    const id = await makePublishable("ver");
    expect(
      await operator().publishProduct(call({ productId: id, expectedRevision: 1, version: "1.0" })),
    ).toEqual({
      ok: false,
      error: "invalid_version",
    });
    expect(
      await operator().publishProduct(
        call({ productId: id, expectedRevision: 99, version: "1.0.0" }),
      ),
    ).toEqual({
      ok: false,
      error: "revision_conflict",
    });
  });

  it("snapshots ready images into product_release_image in the same batch, moves the pointer active, and records the event", async () => {
    const id = await makePublishable("pub");
    // A failed image must NOT be snapshotted.
    await seedImage({
      id: "img-fail",
      productId: id,
      state: "failed",
      role: "gallery",
      position: 1,
    });

    const res = await operator().publishProduct(
      call({ productId: id, expectedRevision: 1, version: "1.0.0" }),
    );
    if (!res.ok) throw new Error("expected ok");

    const [prod] = await db.select().from(productBase).where(eq(productBase.id, id));
    expect(prod!.status).toBe("active");
    expect(prod!.activeReleaseId).toBe(res.value.releaseId);

    const snap = await db
      .select()
      .from(productReleaseImage)
      .where(eq(productReleaseImage.releaseId, res.value.releaseId));
    expect(snap.map((s) => s.imageId)).toEqual(["img-pub"]); // only the ready cover, not img-fail

    // Same-batch event: publish's event row is present alongside the release.
    const publishEvents = (await events()).filter((e) => e.action === "publishProduct");
    expect(publishEvents).toHaveLength(1);
    expect(publishEvents[0]!.targetId).toBe(id);
  });

  it("never mutates stock (INV-REL-1: releases never touch inventory)", async () => {
    const id = await makePublishable("nostk", 7);
    await operator().publishProduct(call({ productId: id, expectedRevision: 1, version: "1.0.0" }));
    const [v] = await db.select().from(productVariant).where(eq(productVariant.productId, id));
    expect(v!.stock).toBe(7);
  });

  it("rejects a duplicate retained version", async () => {
    const id = await makePublishable("dupv");
    expect(
      (
        await operator().publishProduct(
          call({ productId: id, expectedRevision: 1, version: "1.0.0" }),
        )
      ).ok,
    ).toBe(true);
    // publish does not bump the draft revision, so a re-publish at the same
    // version collides on UNIQUE(product_id, version).
    expect(
      await operator().publishProduct(
        call({ productId: id, expectedRevision: 1, version: "1.0.0" }),
      ),
    ).toEqual({
      ok: false,
      error: "version_exists",
    });
  });
});

describe("setProductStatus — release rules (D8)", () => {
  it("active/unavailable require a live release; draft/archived do not", async () => {
    const id = await makePublishable("stat");
    expect(await operator().setProductStatus(call({ productId: id, status: "active" }))).toEqual({
      ok: false,
      error: "no_release",
    });
    expect(
      await operator().setProductStatus(call({ productId: id, status: "unavailable" })),
    ).toEqual({
      ok: false,
      error: "no_release",
    });
    // draft/archived are always allowed with no release.
    expect(
      (await operator().setProductStatus(call({ productId: id, status: "archived" }))).ok,
    ).toBe(true);

    // Publish, then both published-lifecycle transitions succeed.
    await operator().saveProductDraft(call({ productId: id, expectedRevision: 1 })); // bump to rev 2 (archived left draft untouched)
    await operator().publishProduct(call({ productId: id, expectedRevision: 2, version: "1.0.0" }));
    expect(
      (await operator().setProductStatus(call({ productId: id, status: "unavailable" }))).ok,
    ).toBe(true);
    expect((await operator().setProductStatus(call({ productId: id, status: "active" }))).ok).toBe(
      true,
    );

    expect(
      await operator().setProductStatus(call({ productId: "ghost", status: "draft" })),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("putVariant / adjustStock", () => {
  it("creates then updates a variant, enforcing sku/size uniqueness and non-negative stock", async () => {
    const id = await createDraft("var");
    const created = await operator().putVariant(
      call({ productId: id, size: "M", sku: "VAR-M", stock: 3 }),
    );
    if (!created.ok) throw new Error("expected ok");

    // Update in place by variantId.
    const updated = await operator().putVariant(
      call({
        productId: id,
        variantId: created.value.variantId,
        size: "M",
        sku: "VAR-M",
        stock: 9,
      }),
    );
    expect(updated).toEqual({ ok: true, value: { variantId: created.value.variantId } });
    const [row] = await db
      .select()
      .from(productVariant)
      .where(eq(productVariant.id, created.value.variantId));
    expect(row!.stock).toBe(9);

    // A second (create) variant colliding on SKU / on (product,size).
    expect(
      await operator().putVariant(call({ productId: id, size: "L", sku: "VAR-M", stock: 1 })),
    ).toEqual({
      ok: false,
      error: "sku_taken",
    });
    expect(
      await operator().putVariant(call({ productId: id, size: "M", sku: "VAR-L", stock: 1 })),
    ).toEqual({
      ok: false,
      error: "size_taken",
    });
    expect(
      await operator().putVariant(call({ productId: id, size: "S", sku: "VAR-S", stock: -1 })),
    ).toEqual({
      ok: false,
      error: "invalid_stock",
    });
    expect(
      await operator().putVariant(call({ productId: "ghost", size: "S", sku: "G-S", stock: 1 })),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("adjustStock applies a delta but never goes negative (INV-STOCK-1)", async () => {
    const id = await createDraft("adj");
    const v = await operator().putVariant(
      call({ productId: id, size: "M", sku: "ADJ-M", stock: 2 }),
    );
    if (!v.ok) throw new Error("expected ok");
    const variantId = v.value.variantId;

    // Underflow is refused and leaves stock untouched.
    expect(await operator().adjustStock(call({ variantId, delta: -5, reason: "recount" }))).toEqual(
      {
        ok: false,
        error: "negative_stock",
      },
    );
    expect(
      (await db.select().from(productVariant).where(eq(productVariant.id, variantId)))[0]!.stock,
    ).toBe(2);

    // Valid decrement then increment.
    expect(await operator().adjustStock(call({ variantId, delta: -2, reason: "damage" }))).toEqual({
      ok: true,
      value: { stock: 0 },
    });
    expect(await operator().adjustStock(call({ variantId, delta: 3, reason: "restock" }))).toEqual({
      ok: true,
      value: { stock: 3 },
    });

    expect(
      await operator().adjustStock(call({ variantId: "ghost", delta: 1, reason: "x" })),
    ).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("adjustStock replays idempotently — one mutation, one event", async () => {
    const id = await createDraft("idem");
    const v = await operator().putVariant(
      call({ productId: id, size: "M", sku: "IDEM-M", stock: 5 }),
    );
    if (!v.ok) throw new Error("expected ok");
    const c = call(
      { variantId: v.value.variantId, delta: -2, reason: "recount" },
      { action: "adjustStock", commandId: "a1" },
    );
    const first = await operator().adjustStock(c);
    const second = await operator().adjustStock(c);
    expect(first).toEqual({ ok: true, value: { stock: 3 } });
    expect(second).toEqual(first); // replay returns the prior result, no second decrement
    expect(
      (await db.select().from(productVariant).where(eq(productVariant.id, v.value.variantId)))[0]!
        .stock,
    ).toBe(3);
    expect((await events()).filter((e) => e.action === "adjustStock")).toHaveLength(1);
  });
});

describe("reorderProductMedia", () => {
  it("rewrites positions for an exact id set and rejects a mismatched set", async () => {
    const id = await createDraft("media");
    await seedImage({ id: "m1", productId: id, position: 0 });
    await seedImage({ id: "m2", productId: id, position: 1 });
    await seedImage({ id: "m3", productId: id, position: 2 });

    const ok = await operator().reorderProductMedia(
      call({ productId: id, mediaIds: ["m3", "m1", "m2"] }),
    );
    expect(ok).toEqual({ ok: true, value: { ok: true } });
    const rows = await db.select().from(productImage).where(eq(productImage.productId, id));
    const pos = new Map(rows.map((r) => [r.id, r.position]));
    expect([pos.get("m3"), pos.get("m1"), pos.get("m2")]).toEqual([0, 1, 2]);

    // Missing one, and including a stranger id, both fail.
    expect(
      await operator().reorderProductMedia(call({ productId: id, mediaIds: ["m1", "m2"] })),
    ).toEqual({
      ok: false,
      error: "invalid_order",
    });
    expect(
      await operator().reorderProductMedia(
        call({ productId: id, mediaIds: ["m1", "m2", "m3", "ghost"] }),
      ),
    ).toEqual({
      ok: false,
      error: "invalid_order",
    });
  });
});

describe("orders — reads + state machine", () => {
  it("getOrder maps the row + items; listOrders filters by status", async () => {
    await seedOrder({
      id: "o1",
      orderNumber: "SI-A1",
      status: "pending",
      subtotalCents: 3000,
      totalCents: 3000,
    });
    await seedOrderItem({ id: "i1", orderId: "o1", productId: "p1", variantId: "v1", quantity: 2 });
    await seedOrder({
      id: "o2",
      orderNumber: "SI-A2",
      status: "paid",
      subtotalCents: 1000,
      totalCents: 1000,
    });

    const got = await operator().getOrder(call({ orderNumber: "SI-A1" }));
    if (!got.ok) throw new Error("expected ok");
    expect(got.value).toMatchObject({
      orderNumber: "SI-A1",
      status: "pending",
      totalCents: 3000,
      shipping: {
        name: "Ada",
        line1: "1 Main",
        city: "Toronto",
        region: "ON",
        postal: "M5V",
        country: "CA",
      },
    });
    expect(got.value.items).toEqual([
      {
        productId: "p1",
        variantId: "v1",
        title: "t",
        size: "M",
        unitPriceCents: 3000,
        quantity: 2,
      },
    ]);
    expect(await operator().getOrder(call({ orderNumber: "SI-NOPE" }))).toEqual({
      ok: false,
      error: "not_found",
    });

    const paid = await operator().listOrders(call({ status: "paid" }));
    if (!paid.ok) throw new Error("expected ok");
    expect(paid.value.orders.map((o) => o.orderNumber)).toEqual(["SI-A2"]);
  });

  it("cannot ship an unpaid order; cannot reactivate a cancelled one", async () => {
    await seedOrder({
      id: "o1",
      orderNumber: "SI-B1",
      status: "pending",
      subtotalCents: 1000,
      totalCents: 1000,
    });

    // Unpaid → cannot ship.
    expect(
      await operator().fulfillOrder(
        call({ orderNumber: "SI-B1", carrier: "canadapost", trackingNumber: "TRK1" }),
      ),
    ).toEqual({ ok: false, error: "payment_incomplete" });

    // Cancel a pending order, then a mark-paid cannot re-enter the flow.
    const cancelled = await operator().setOrderStatus(
      call({ orderNumber: "SI-B1", status: "cancelled" }),
    );
    if (!cancelled.ok) throw new Error("expected ok");
    expect(cancelled.value.status).toBe("cancelled");
    expect(await operator().setOrderStatus(call({ orderNumber: "SI-B1", status: "paid" }))).toEqual(
      {
        ok: false,
        error: "invalid_transition",
      },
    );
  });

  it("pending → paid → shipped → delivered happy path, one event each", async () => {
    await seedOrder({
      id: "o1",
      orderNumber: "SI-C1",
      status: "pending",
      subtotalCents: 1000,
      totalCents: 1000,
    });

    const paid = await operator().setOrderStatus(call({ orderNumber: "SI-C1", status: "paid" }));
    if (!paid.ok) throw new Error("expected ok");
    expect(paid.value).toMatchObject({ status: "paid", paymentStatus: "paid" });

    const shipped = await operator().fulfillOrder(
      call({
        orderNumber: "SI-C1",
        carrier: "canadapost",
        trackingNumber: "TRK9",
        note: "handle care",
      }),
    );
    if (!shipped.ok) throw new Error("expected ok");
    expect(shipped.value).toMatchObject({
      status: "shipped",
      carrier: "canadapost",
      trackingNumber: "TRK9",
    });
    expect(shipped.value.shippedAt).toBeGreaterThan(0);

    const delivered = await operator().markDelivered(call({ orderNumber: "SI-C1" }));
    if (!delivered.ok) throw new Error("expected ok");
    expect(delivered.value.status).toBe("delivered");
    expect(delivered.value.deliveredAt).toBeGreaterThan(0);

    // markDelivered only from shipped; a fresh call on a delivered order is invalid.
    expect(await operator().markDelivered(call({ orderNumber: "SI-C1" }))).toEqual({
      ok: false,
      error: "invalid_transition",
    });

    // One event per mutation: paid + shipped + delivered = 3 (the failed calls wrote none).
    expect(await events()).toHaveLength(3);
  });
});

describe("listProducts / getProduct — operator view (draft fields)", () => {
  it("lists drafts with status/revision and returns the full aggregate", async () => {
    const id = await makePublishable("agg");
    await operator().publishProduct(call({ productId: id, expectedRevision: 1, version: "1.0.0" }));

    const list = await operator().listProducts(call({ status: "all" }));
    if (!list.ok) throw new Error("expected ok");
    const card = list.value.products.find((p) => p.productId === id);
    expect(card).toMatchObject({
      slug: "agg",
      status: "active",
      activeVersion: "1.0.0",
      revision: 1,
    });

    const detail = await operator().getProduct(call({ productId: id }));
    if (!detail.ok) throw new Error("expected ok");
    expect(detail.value.draft).toMatchObject({
      slug: "agg",
      status: "active",
      activeVersion: "1.0.0",
    });
    expect(detail.value.releases.map((r) => r.version)).toEqual(["1.0.0"]);
    expect(detail.value.variants.map((v) => v.size)).toEqual(["M"]);
    expect(detail.value.media.map((m) => m.id)).toEqual(["img-agg"]);
    expect(detail.value.media[0]).toMatchObject({
      state: "ready",
      href: "/api/store/media/img-agg",
      role: "cover",
    });

    expect(await operator().getProduct(call({ productId: "ghost" }))).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
