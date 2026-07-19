// Request-path cores for the `StoreOperator` mutation RPC (RFC-0001
// "StoreOperator RPC" / D3, D8, D13). Extracted from the WorkerEntrypoint
// wrapper (store-operator.ts) so the whole D1 write path is pool-testable against
// a real local D1 — same split as catalog.ts / checkout.ts.
//
// Every method takes `OperatorCall<T>`. `meta.idempotencyKey` is
// `<sub>:<action>:<commandId>`, constructed by OPERATOR (the caller); here it is
// honored via `store_operator_event` UNIQUE(idempotency_key, action): a replay
// returns the recorded `response_json` without re-mutating (INV-AUDIT-1). Each
// success writes exactly one domain mutation AND one event in the SAME D1 batch;
// a typed-error return writes no event, so a failed call is safely retryable.
import { and, asc, count, desc, eq, lt, ne, or, sql } from "drizzle-orm";
import { ulid } from "@somewhatintelligent/kit/ids";
import { err, isValidVersion, ok } from "@si/contracts";
import type {
  OperatorMeta,
  OrderDetailDTO,
  OrderStatus,
  ProductMediaDTO,
  ProductVariantDTO,
  StoreOperatorEntrypoint,
} from "@si/contracts";

import { clampLimit, decodeCursor, encodeCursor, mediaHref, sortBySize } from "@/lib/catalog";
import { isOrderStatus } from "@/lib/config";
import type { Db } from "@/lib/db";
import { type DbBatchItem, runBatch } from "@/lib/db-batch";
import {
  customerOrder,
  type CustomerOrder,
  orderItem,
  type OrderItem,
  productBase,
  productDraft,
  productImage,
  productRelease,
  productReleaseImage,
  productVariant,
  storeOperatorEvent,
} from "@/db/schema";

// Each core's call/result shape IS the contract method's — deriving them from
// `StoreOperatorEntrypoint` keeps the cores exactly conformant with @si/contracts
// (the SSOT) with no locally-forked DTOs.
type Call<M extends keyof StoreOperatorEntrypoint> = Parameters<StoreOperatorEntrypoint[M]>[0];
type Res<M extends keyof StoreOperatorEntrypoint> = ReturnType<StoreOperatorEntrypoint[M]>;

// ── Idempotency + audit (INV-AUDIT-1) ────────────────────────────────────────

// Only successful mutations record an event, so a recorded row is always a
// success replay.
const SUCCESS = "success";

/** The recorded success `response_json` for `<action>` under this idempotency
 *  key, or null. Replay returns it verbatim without re-running the mutation. */
async function recordedResponse<T>(db: Db, meta: OperatorMeta, action: string): Promise<T | null> {
  const [row] = await db
    .select({ responseJson: storeOperatorEvent.responseJson })
    .from(storeOperatorEvent)
    .where(
      and(
        eq(storeOperatorEvent.idempotencyKey, meta.idempotencyKey),
        eq(storeOperatorEvent.action, action),
      ),
    )
    .limit(1);
  if (!row) return null;
  return row.responseJson ? (JSON.parse(row.responseJson) as T) : null;
}

interface EventFacts {
  targetType: string;
  targetId: string;
  /** Identifiers and counts only — never a body, blob, or secret (D13). */
  detail?: Record<string, unknown>;
}

/** The `store_operator_event` insert that commits IN THE SAME BATCH as the domain
 *  mutation. `response` is the narrow success value replayed on an idempotent
 *  retry. */
function eventInsert(
  db: Db,
  meta: OperatorMeta,
  action: string,
  facts: EventFacts,
  response: unknown,
): DbBatchItem {
  return db.insert(storeOperatorEvent).values({
    id: ulid(),
    operatorSub: meta.actor.sub,
    operatorEmail: meta.actor.email,
    action,
    targetType: facts.targetType,
    targetId: facts.targetId,
    requestId: meta.requestId,
    idempotencyKey: meta.idempotencyKey,
    outcome: SUCCESS,
    detailJson: facts.detail ? JSON.stringify(facts.detail) : null,
    responseJson: JSON.stringify(response),
    createdAt: new Date(),
  });
}

function isNonNegativeInt(n: number): boolean {
  return Number.isInteger(n) && n >= 0;
}

// ── Product reads (operator view — includes draft fields) ────────────────────

export async function listProducts(db: Db, call: Call<"listProducts">): Res<"listProducts"> {
  const { input } = call;
  const limit = clampLimit(input.limit);
  let keyset;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (cursor === null) return err("invalid_cursor");
    const at = new Date(cursor.updatedAt);
    keyset = or(
      lt(productBase.updatedAt, at),
      and(eq(productBase.updatedAt, at), lt(productBase.id, cursor.id)),
    );
  }
  const statusFilter =
    input.status !== undefined && input.status !== "all"
      ? eq(productBase.status, input.status)
      : undefined;

  const rows = await db
    .select({
      productId: productBase.id,
      slug: productBase.slug,
      status: productBase.status,
      updatedAt: productBase.updatedAt,
      revision: productDraft.revision,
      title: productDraft.title,
      descriptionMarkdown: productDraft.descriptionMarkdown,
      priceCents: productDraft.priceCents,
      activeVersion: productRelease.version,
    })
    .from(productBase)
    .innerJoin(productDraft, eq(productDraft.productId, productBase.id))
    .leftJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
    .where(and(statusFilter, keyset))
    .orderBy(desc(productBase.updatedAt), desc(productBase.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const products = page.map((r) => ({
    productId: r.productId,
    slug: r.slug,
    revision: r.revision,
    title: r.title,
    descriptionMarkdown: r.descriptionMarkdown,
    priceCents: r.priceCents,
    status: r.status,
    activeVersion: r.activeVersion ?? null,
    updatedAt: r.updatedAt.getTime(),
  }));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({ updatedAt: last.updatedAt.getTime(), id: last.productId })
      : null;
  return ok({ products, nextCursor });
}

export async function getProduct(db: Db, call: Call<"getProduct">): Res<"getProduct"> {
  const { productId } = call.input;
  const [row] = await db
    .select({
      productId: productBase.id,
      slug: productBase.slug,
      status: productBase.status,
      updatedAt: productBase.updatedAt,
      revision: productDraft.revision,
      title: productDraft.title,
      descriptionMarkdown: productDraft.descriptionMarkdown,
      priceCents: productDraft.priceCents,
      activeVersion: productRelease.version,
    })
    .from(productBase)
    .innerJoin(productDraft, eq(productDraft.productId, productBase.id))
    .leftJoin(productRelease, eq(productRelease.id, productBase.activeReleaseId))
    .where(eq(productBase.id, productId))
    .limit(1);
  if (!row) return err("not_found");

  const [releaseRows, variantRows, imageRows] = await Promise.all([
    db
      .select({
        id: productRelease.id,
        version: productRelease.version,
        publishedAt: productRelease.publishedAt,
      })
      .from(productRelease)
      .where(eq(productRelease.productId, productId))
      .orderBy(desc(productRelease.publishedAt)),
    db.select().from(productVariant).where(eq(productVariant.productId, productId)),
    db
      .select()
      .from(productImage)
      .where(eq(productImage.productId, productId))
      .orderBy(asc(productImage.position)),
  ]);

  const draft = {
    productId: row.productId,
    slug: row.slug,
    revision: row.revision,
    title: row.title,
    descriptionMarkdown: row.descriptionMarkdown,
    priceCents: row.priceCents,
    status: row.status,
    activeVersion: row.activeVersion ?? null,
    updatedAt: row.updatedAt.getTime(),
  };
  const releases = releaseRows.map((r) => ({
    id: r.id,
    version: r.version,
    publishedAt: r.publishedAt.getTime(),
  }));
  const variants: ProductVariantDTO[] = sortBySize(variantRows).map((v) => ({
    id: v.id,
    size: v.size,
    sku: v.sku,
    stock: v.stock,
    available: v.stock > 0,
  }));
  const media: ProductMediaDTO[] = imageRows.map((img) => ({
    id: img.id,
    productId: img.productId,
    alt: img.alt,
    role: img.role,
    position: img.position,
    // ProductMediaDTO admits only ready|failed; a still-pending upload reads as
    // not-yet-servable (href null) like a failed one.
    state: img.state === "ready" ? "ready" : "failed",
    href: img.state === "ready" ? mediaHref(img.id) : null,
    contentType: img.contentType,
    size: img.sizeBytes,
    sha256: img.contentSha256,
    width: img.width,
    height: img.height,
  }));
  return ok({ draft, releases, variants, media });
}

// ── Product mutations ────────────────────────────────────────────────────────

export async function createProduct(db: Db, call: Call<"createProduct">): Res<"createProduct"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ productId: string; revision: 1 }>(
    db,
    meta,
    "createProduct",
  );
  if (replay) return ok(replay);

  if (!isNonNegativeInt(input.priceCents)) return err("invalid_price");
  const [clash] = await db
    .select({ id: productBase.id })
    .from(productBase)
    .where(eq(productBase.slug, input.slug))
    .limit(1);
  if (clash) return err("slug_taken");

  const productId = ulid();
  const now = new Date();
  const value = { productId, revision: 1 as const };
  await runBatch(db, [
    db.insert(productBase).values({
      id: productId,
      slug: input.slug,
      status: "draft",
      createdBySub: meta.actor.sub,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(productDraft).values({
      productId,
      revision: 1,
      title: input.title,
      descriptionMarkdown: input.descriptionMarkdown ?? null,
      priceCents: input.priceCents,
      updatedBySub: meta.actor.sub,
      updatedAt: now,
    }),
    eventInsert(db, meta, "createProduct", { targetType: "product", targetId: productId }, value),
  ]);
  return ok(value);
}

export async function saveProductDraft(
  db: Db,
  call: Call<"saveProductDraft">,
): Res<"saveProductDraft"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ revision: number; updatedAt: number }>(
    db,
    meta,
    "saveProductDraft",
  );
  if (replay) return ok(replay);

  const [row] = await db
    .select({ slug: productBase.slug, revision: productDraft.revision })
    .from(productBase)
    .innerJoin(productDraft, eq(productDraft.productId, productBase.id))
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!row) return err("not_found");
  if (row.revision !== input.expectedRevision) return err("revision_conflict");
  if (input.priceCents !== undefined && !isNonNegativeInt(input.priceCents)) {
    return err("invalid_price");
  }
  const slugChanged = input.slug !== undefined && input.slug !== row.slug;
  if (slugChanged) {
    const [taken] = await db
      .select({ id: productBase.id })
      .from(productBase)
      .where(and(eq(productBase.slug, input.slug!), ne(productBase.id, input.productId)))
      .limit(1);
    if (taken) return err("slug_taken");
  }

  const now = new Date();
  const newRevision = row.revision + 1;
  const draftSet: Partial<typeof productDraft.$inferInsert> = {
    revision: newRevision,
    updatedBySub: meta.actor.sub,
    updatedAt: now,
  };
  // `descriptionMarkdown` distinguishes provided-null from absent: JSON drops
  // undefined but keeps null, so `!== undefined` correctly detects a clear.
  if (input.title !== undefined) draftSet.title = input.title;
  if (input.descriptionMarkdown !== undefined)
    draftSet.descriptionMarkdown = input.descriptionMarkdown;
  if (input.priceCents !== undefined) draftSet.priceCents = input.priceCents;

  const value = { revision: newRevision, updatedAt: now.getTime() };
  await runBatch(db, [
    db.update(productDraft).set(draftSet).where(eq(productDraft.productId, input.productId)),
    db
      .update(productBase)
      .set(slugChanged ? { slug: input.slug!, updatedAt: now } : { updatedAt: now })
      .where(eq(productBase.id, input.productId)),
    eventInsert(
      db,
      meta,
      "saveProductDraft",
      { targetType: "product", targetId: input.productId },
      value,
    ),
  ]);
  return ok(value);
}

export async function publishProduct(db: Db, call: Call<"publishProduct">): Res<"publishProduct"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{
    releaseId: string;
    version: string;
    publishedAt: number;
  }>(db, meta, "publishProduct");
  if (replay) return ok(replay);

  const [row] = await db
    .select({
      slug: productBase.slug,
      revision: productDraft.revision,
      title: productDraft.title,
      descriptionMarkdown: productDraft.descriptionMarkdown,
      priceCents: productDraft.priceCents,
    })
    .from(productBase)
    .innerJoin(productDraft, eq(productDraft.productId, productBase.id))
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!row) return err("not_found");
  if (row.revision !== input.expectedRevision) return err("revision_conflict");
  if (!isValidVersion(input.version)) return err("invalid_version");
  const [dup] = await db
    .select({ id: productRelease.id })
    .from(productRelease)
    .where(
      and(eq(productRelease.productId, input.productId), eq(productRelease.version, input.version)),
    )
    .limit(1);
  if (dup) return err("version_exists");

  // Publish requires ≥1 ready image AND ≥1 variant; the ready images are frozen
  // into the release (snapshot) in the SAME batch as the pointer move.
  const readyImages = await db
    .select({
      id: productImage.id,
      alt: productImage.alt,
      role: productImage.role,
      position: productImage.position,
    })
    .from(productImage)
    .where(and(eq(productImage.productId, input.productId), eq(productImage.state, "ready")))
    .orderBy(asc(productImage.position));
  if (readyImages.length === 0) return err("missing_media");
  const [variantAgg] = await db
    .select({ n: count() })
    .from(productVariant)
    .where(eq(productVariant.productId, input.productId));
  if ((variantAgg?.n ?? 0) === 0) return err("missing_variant");

  const releaseId = ulid();
  const now = new Date();
  const value = { releaseId, version: input.version, publishedAt: now.getTime() };
  // Product publication NEVER changes stock (releases never mutate inventory) —
  // no product_variant write appears in this batch.
  await runBatch(db, [
    db.insert(productRelease).values({
      id: releaseId,
      productId: input.productId,
      version: input.version,
      slug: row.slug,
      title: row.title,
      descriptionMarkdown: row.descriptionMarkdown,
      priceCents: row.priceCents,
      publishedBySub: meta.actor.sub,
      publishedAt: now,
    }),
    ...readyImages.map((img) =>
      db.insert(productReleaseImage).values({
        releaseId,
        imageId: img.id,
        alt: img.alt,
        role: img.role,
        position: img.position,
      }),
    ),
    db
      .update(productBase)
      .set({ activeReleaseId: releaseId, status: "active", updatedAt: now })
      .where(eq(productBase.id, input.productId)),
    eventInsert(
      db,
      meta,
      "publishProduct",
      {
        targetType: "product",
        targetId: input.productId,
        detail: { version: input.version, imageCount: readyImages.length },
      },
      value,
    ),
  ]);
  return ok(value);
}

export async function setProductStatus(
  db: Db,
  call: Call<"setProductStatus">,
): Res<"setProductStatus"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ status: (typeof input)["status"] }>(
    db,
    meta,
    "setProductStatus",
  );
  if (replay) return ok(replay);

  const [product] = await db
    .select({ id: productBase.id, activeReleaseId: productBase.activeReleaseId })
    .from(productBase)
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!product) return err("not_found");
  // `active` and `unavailable` are published-lifecycle states — both require a
  // live release (D8: `unavailable` is a published product pulled from sale).
  // `draft` and `archived` need none.
  if (
    (input.status === "active" || input.status === "unavailable") &&
    product.activeReleaseId === null
  ) {
    return err("no_release");
  }

  const now = new Date();
  const value = { status: input.status };
  await runBatch(db, [
    db
      .update(productBase)
      .set({ status: input.status, updatedAt: now })
      .where(eq(productBase.id, input.productId)),
    eventInsert(
      db,
      meta,
      "setProductStatus",
      { targetType: "product", targetId: input.productId, detail: { status: input.status } },
      value,
    ),
  ]);
  return ok(value);
}

// ── Variants + inventory ─────────────────────────────────────────────────────

export async function putVariant(db: Db, call: Call<"putVariant">): Res<"putVariant"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ variantId: string }>(db, meta, "putVariant");
  if (replay) return ok(replay);

  if (!isNonNegativeInt(input.stock)) return err("invalid_stock");
  const [product] = await db
    .select({ id: productBase.id })
    .from(productBase)
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!product) return err("not_found");

  const variantId = input.variantId;
  if (variantId !== undefined) {
    const [existing] = await db
      .select({ id: productVariant.id, productId: productVariant.productId })
      .from(productVariant)
      .where(eq(productVariant.id, variantId))
      .limit(1);
    if (!existing || existing.productId !== input.productId) return err("not_found");
  }

  // Global SKU uniqueness; (product, size) uniqueness — excluding this variant on
  // an update.
  const [skuClash] = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(
      variantId !== undefined
        ? and(eq(productVariant.sku, input.sku), ne(productVariant.id, variantId))
        : eq(productVariant.sku, input.sku),
    )
    .limit(1);
  if (skuClash) return err("sku_taken");
  const [sizeClash] = await db
    .select({ id: productVariant.id })
    .from(productVariant)
    .where(
      variantId !== undefined
        ? and(
            eq(productVariant.productId, input.productId),
            eq(productVariant.size, input.size),
            ne(productVariant.id, variantId),
          )
        : and(eq(productVariant.productId, input.productId), eq(productVariant.size, input.size)),
    )
    .limit(1);
  if (sizeClash) return err("size_taken");

  const now = new Date();
  const id = variantId ?? ulid();
  const value = { variantId: id };
  const mutation =
    variantId !== undefined
      ? db
          .update(productVariant)
          .set({ size: input.size, sku: input.sku, stock: input.stock })
          .where(eq(productVariant.id, variantId))
      : db.insert(productVariant).values({
          id,
          productId: input.productId,
          size: input.size,
          sku: input.sku,
          stock: input.stock,
          createdAt: now,
        });
  await runBatch(db, [
    mutation,
    eventInsert(
      db,
      meta,
      "putVariant",
      {
        targetType: "product_variant",
        targetId: id,
        detail: { productId: input.productId, size: input.size, stock: input.stock },
      },
      value,
    ),
  ]);
  return ok(value);
}

export async function adjustStock(db: Db, call: Call<"adjustStock">): Res<"adjustStock"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ stock: number }>(db, meta, "adjustStock");
  if (replay) return ok(replay);

  const [variant] = await db
    .select({ id: productVariant.id, stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, input.variantId))
    .limit(1);
  if (!variant) return err("not_found");
  const newStock = variant.stock + input.delta;
  if (newStock < 0) return err("negative_stock");

  const value = { stock: newStock };
  // Relative UPDATE applies the delta atomically; the `stock_non_negative` DB
  // CHECK is the concurrent-underflow backstop — a racing adjust that drives
  // stock below zero aborts the WHOLE batch, so no event commits for a
  // no-op (INV-STOCK-1). The reason is recorded as audit metadata (identifiers +
  // counts).
  try {
    await runBatch(db, [
      db
        .update(productVariant)
        .set({ stock: sql`${productVariant.stock} + ${input.delta}` })
        .where(eq(productVariant.id, input.variantId)),
      eventInsert(
        db,
        meta,
        "adjustStock",
        {
          targetType: "product_variant",
          targetId: input.variantId,
          detail: { delta: input.delta, reason: input.reason, stock: newStock },
        },
        value,
      ),
    ]);
  } catch {
    return err("negative_stock");
  }
  return ok(value);
}

// ── Product media order ──────────────────────────────────────────────────────

export async function reorderProductMedia(
  db: Db,
  call: Call<"reorderProductMedia">,
): Res<"reorderProductMedia"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ ok: true }>(db, meta, "reorderProductMedia");
  if (replay) return ok(replay);

  const [product] = await db
    .select({ id: productBase.id })
    .from(productBase)
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!product) return err("not_found");

  const images = await db
    .select({ id: productImage.id })
    .from(productImage)
    .where(eq(productImage.productId, input.productId));
  const owned = new Set(images.map((i) => i.id));
  const requested = new Set(input.mediaIds);
  // The requested id set must match the product's media EXACTLY — no missing, no
  // extra, no duplicates.
  if (
    requested.size !== input.mediaIds.length ||
    requested.size !== owned.size ||
    input.mediaIds.some((id) => !owned.has(id))
  ) {
    return err("invalid_order");
  }

  const value = { ok: true as const };
  await runBatch(db, [
    ...input.mediaIds.map((id, i) =>
      db.update(productImage).set({ position: i }).where(eq(productImage.id, id)),
    ),
    eventInsert(
      db,
      meta,
      "reorderProductMedia",
      {
        targetType: "product",
        targetId: input.productId,
        detail: { count: input.mediaIds.length },
      },
      value,
    ),
  ]);
  return ok(value);
}

// ── Orders ───────────────────────────────────────────────────────────────────

// The subset of a customer_order row `buildOrderDetail` reads. Both the DB row
// and the in-memory post-mutation row satisfy it structurally.
type OrderRow = Pick<
  CustomerOrder,
  | "orderNumber"
  | "userId"
  | "email"
  | "status"
  | "paymentStatus"
  | "subtotalCents"
  | "shippingCents"
  | "totalCents"
  | "shipName"
  | "shipLine1"
  | "shipLine2"
  | "shipCity"
  | "shipRegion"
  | "shipPostal"
  | "shipPhone"
  | "carrier"
  | "trackingNumber"
  | "fulfillmentNote"
  | "shippedAt"
  | "deliveredAt"
>;

function buildShipping(o: OrderRow): OrderDetailDTO["shipping"] {
  if (
    o.shipName === null ||
    o.shipLine1 === null ||
    o.shipCity === null ||
    o.shipRegion === null ||
    o.shipPostal === null
  ) {
    return null;
  }
  return {
    name: o.shipName,
    line1: o.shipLine1,
    ...(o.shipLine2 !== null ? { line2: o.shipLine2 } : {}),
    city: o.shipCity,
    region: o.shipRegion,
    postal: o.shipPostal,
    country: "CA",
    ...(o.shipPhone !== null ? { phone: o.shipPhone } : {}),
  };
}

function buildOrderDetail(order: OrderRow, items: OrderItem[]): OrderDetailDTO {
  return {
    orderNumber: order.orderNumber,
    customerId: order.userId,
    email: order.email,
    status: order.status as OrderStatus,
    paymentStatus: order.paymentStatus,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    shipping: buildShipping(order),
    carrier: order.carrier,
    trackingNumber: order.trackingNumber,
    fulfillmentNote: order.fulfillmentNote,
    shippedAt: order.shippedAt ? order.shippedAt.getTime() : null,
    deliveredAt: order.deliveredAt ? order.deliveredAt.getTime() : null,
    items: items.map((it) => ({
      productId: it.productId,
      variantId: it.variantId,
      title: it.titleSnapshot,
      size: it.sizeSnapshot,
      unitPriceCents: it.unitPriceCents,
      quantity: it.quantity,
    })),
  };
}

export async function listOrders(db: Db, call: Call<"listOrders">): Res<"listOrders"> {
  const { input } = call;
  const limit = clampLimit(input.limit);
  let keyset;
  if (input.cursor !== undefined) {
    const cursor = decodeCursor(input.cursor);
    if (cursor === null) return err("invalid_cursor");
    const at = new Date(cursor.updatedAt);
    keyset = or(
      lt(customerOrder.createdAt, at),
      and(eq(customerOrder.createdAt, at), lt(customerOrder.id, cursor.id)),
    );
  }
  const statusFilter =
    input.status !== undefined && input.status !== "all" && isOrderStatus(input.status)
      ? eq(customerOrder.status, input.status)
      : undefined;

  const rows = await db
    .select({
      id: customerOrder.id,
      orderNumber: customerOrder.orderNumber,
      email: customerOrder.email,
      shipName: customerOrder.shipName,
      totalCents: customerOrder.totalCents,
      status: customerOrder.status,
      paymentStatus: customerOrder.paymentStatus,
      createdAt: customerOrder.createdAt,
    })
    .from(customerOrder)
    .where(and(statusFilter, keyset))
    .orderBy(desc(customerOrder.createdAt), desc(customerOrder.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const orders = page.map((o) => ({
    orderNumber: o.orderNumber,
    email: o.email,
    shipName: o.shipName,
    totalCents: o.totalCents,
    status: o.status as OrderStatus,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt.getTime(),
  }));
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeCursor({ updatedAt: last.createdAt.getTime(), id: last.id }) : null;
  return ok({ orders, nextCursor });
}

/** Load an order + its items and build the detail DTO, or null if missing. */
async function loadOrderDetail(db: Db, orderNumber: string): Promise<OrderDetailDTO | null> {
  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.orderNumber, orderNumber))
    .limit(1);
  if (!order) return null;
  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
  return buildOrderDetail(order, items);
}

export async function getOrder(db: Db, call: Call<"getOrder">): Res<"getOrder"> {
  const detail = await loadOrderDetail(db, call.input.orderNumber);
  return detail ? ok(detail) : err("not_found");
}

export async function setOrderStatus(db: Db, call: Call<"setOrderStatus">): Res<"setOrderStatus"> {
  const { input, meta } = call;
  const replay = await recordedResponse<OrderDetailDTO>(db, meta, "setOrderStatus");
  if (replay) return ok(replay);

  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.orderNumber, input.orderNumber))
    .limit(1);
  if (!order) return err("not_found");

  const now = new Date();
  let changes: Partial<CustomerOrder>;
  if (input.status === "paid") {
    // Manual mark-paid is valid only from `pending`; marking paid never
    // decrements stock a second time (stock moved once, at reservation).
    if (order.status !== "pending") return err("invalid_transition");
    changes = { status: "paid", paymentStatus: "paid", updatedAt: now };
  } else {
    // Cancel is valid before the order ships. A shipped/delivered order is
    // already_fulfilled; a cancelled order stays cancelled (cannot re-enter).
    if (order.status === "shipped" || order.status === "delivered") return err("already_fulfilled");
    if (order.status === "cancelled") return err("invalid_transition");
    changes = { status: "cancelled", updatedAt: now };
  }

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
  const dto = buildOrderDetail({ ...order, ...changes }, items);
  await runBatch(db, [
    db.update(customerOrder).set(changes).where(eq(customerOrder.id, order.id)),
    eventInsert(
      db,
      meta,
      "setOrderStatus",
      {
        targetType: "customer_order",
        targetId: order.orderNumber,
        detail: { status: input.status },
      },
      dto,
    ),
  ]);
  return ok(dto);
}

export async function fulfillOrder(db: Db, call: Call<"fulfillOrder">): Res<"fulfillOrder"> {
  const { input, meta } = call;
  const replay = await recordedResponse<OrderDetailDTO>(db, meta, "fulfillOrder");
  if (replay) return ok(replay);

  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.orderNumber, input.orderNumber))
    .limit(1);
  if (!order) return err("not_found");
  if (order.status === "cancelled") return err("invalid_transition");
  if (order.status === "pending") return err("payment_incomplete"); // cannot ship unpaid
  if (order.status === "shipped" || order.status === "delivered") return err("already_fulfilled");
  // order.status === "paid" → ship it.

  const now = new Date();
  const changes: Partial<CustomerOrder> = {
    status: "shipped",
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    fulfillmentNote: input.note ?? null,
    shippedAt: now,
    updatedAt: now,
  };
  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
  const dto = buildOrderDetail({ ...order, ...changes }, items);
  await runBatch(db, [
    db.update(customerOrder).set(changes).where(eq(customerOrder.id, order.id)),
    eventInsert(
      db,
      meta,
      "fulfillOrder",
      {
        targetType: "customer_order",
        targetId: order.orderNumber,
        detail: { carrier: input.carrier },
      },
      dto,
    ),
  ]);
  return ok(dto);
}

export async function markDelivered(db: Db, call: Call<"markDelivered">): Res<"markDelivered"> {
  const { input, meta } = call;
  const replay = await recordedResponse<OrderDetailDTO>(db, meta, "markDelivered");
  if (replay) return ok(replay);

  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.orderNumber, input.orderNumber))
    .limit(1);
  if (!order) return err("not_found");
  if (order.status !== "shipped") return err("invalid_transition"); // only a shipped order delivers

  const now = new Date();
  const changes: Partial<CustomerOrder> = { status: "delivered", deliveredAt: now, updatedAt: now };
  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
  const dto = buildOrderDetail({ ...order, ...changes }, items);
  await runBatch(db, [
    db.update(customerOrder).set(changes).where(eq(customerOrder.id, order.id)),
    eventInsert(
      db,
      meta,
      "markDelivered",
      { targetType: "customer_order", targetId: order.orderNumber },
      dto,
    ),
  ]);
  return ok(dto);
}
