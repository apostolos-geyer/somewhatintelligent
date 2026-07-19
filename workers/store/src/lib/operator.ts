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
import { and, asc, count, countDistinct, desc, eq, inArray, lt, ne, or, sql } from "drizzle-orm";
import { ulid } from "@somewhatintelligent/kit/ids";
import { err, isValidVersion, ok } from "@si/contracts";
import type {
  DeletionError,
  DeletionImpact,
  DeletionPlan,
  OperatorMeta,
  OrderDetailDTO,
  OrderStatus,
  ProductMediaDTO,
  ProductStatus,
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
  storeMediaGcOutbox,
  storeOperatorDeletionIntent,
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

// ── Hard delete: two-step plan/confirm (RFC-0001 D8, INV-DEL-1..4) ────────────
//
// plan* is a read-only impact preview that mints a short-lived confirmation
// token: it stores ONLY the token's SHA-256 hash, a canonical impact hash, the
// operator sub, the confirm action, and the plan subject — never a dependency
// graph. delete* consumes the token: it re-derives the impact from CURRENT data
// and rejects any drift, then performs ONE ordered batch (explicit child
// deletes → aggregate, active-pointer repoint BEFORE the release row is
// removed, media-GC outbox inserts, intent consume, audit event LAST). No
// statement here ever touches customer_order, order_item, the Stripe ledgers,
// reservations, or fulfillment (INV-DEL-2): order history stays byte-identical
// across a catalog delete.

const DELETION_TTL_MS = 10 * 60 * 1000;

// The plan subject persisted in the intent's `target_id` — every field delete*
// needs to re-derive the impact and drive the batch. (The token carries no
// target of its own; the subject is recovered from the intent, so an operator
// cannot redirect a confirmed token at a different aggregate.)
type ReleaseSubject = { productId: string; releaseId: string; replacementReleaseId: string | null };
type ProductSubject = { productId: string };
type VariantSubject = { productId: string; variantId: string };
type MediaSubject = { productId: string; mediaId: string };

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function newConfirmationToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

// Recursively key-sorted serialization so the impact hash is stable regardless
// of property insertion order — the drift check compares hashes, not objects.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function impactHashOf(impact: DeletionImpact): Promise<string> {
  return sha256Hex(JSON.stringify(canonicalize(impact)));
}

/** Mint + persist a deletion intent and return the plan the operator confirms
 *  against. `action` is the confirm method's name (matched at execution). */
async function writeDeletionPlan(
  db: Db,
  meta: OperatorMeta,
  action: string,
  subject: unknown,
  impact: DeletionImpact,
): Promise<DeletionPlan> {
  const token = newConfirmationToken();
  const [tokenHash, impactHash] = await Promise.all([sha256Hex(token), impactHashOf(impact)]);
  const expiresAt = new Date(Date.now() + DELETION_TTL_MS);
  await db.insert(storeOperatorDeletionIntent).values({
    tokenHash,
    operatorSub: meta.actor.sub,
    action,
    targetId: JSON.stringify(subject),
    impactHash,
    expiresAt,
    consumedAt: null,
  });
  return { impact, confirmationToken: token, expiresAt: expiresAt.getTime() };
}

type VerifiedIntent<S> =
  | { ok: false; error: DeletionError }
  | { ok: true; tokenHash: string; impactHash: string; subject: S };

// Verify a confirmation token against its intent: existence, operator, action,
// expiry, and prior consumption — every mismatch its own DeletionError. Token
// consumption is checked here; idempotency-key replay is a separate, earlier
// gate (recordedResponse), so a retried OperatorCall never reaches this.
async function verifyDeletionIntent<S>(
  db: Db,
  token: string,
  operatorSub: string,
  action: string,
  nowMs: number,
): Promise<VerifiedIntent<S>> {
  const tokenHash = await sha256Hex(token);
  const [intent] = await db
    .select()
    .from(storeOperatorDeletionIntent)
    .where(eq(storeOperatorDeletionIntent.tokenHash, tokenHash))
    .limit(1);
  if (!intent) return { ok: false, error: "deletion_plan_mismatch" };
  if (intent.operatorSub !== operatorSub) return { ok: false, error: "deletion_plan_mismatch" };
  if (intent.action !== action) return { ok: false, error: "deletion_plan_mismatch" };
  if (intent.expiresAt.getTime() < nowMs) return { ok: false, error: "deletion_plan_expired" };
  if (intent.consumedAt !== null) return { ok: false, error: "deletion_already_executed" };
  return {
    ok: true,
    tokenHash,
    impactHash: intent.impactHash,
    subject: JSON.parse(intent.targetId) as S,
  };
}

/** One media-GC outbox row: the physical byte delete deferred to the drain. */
function gcOutboxInsert(db: Db, storageKey: string, now: Date): DbBatchItem {
  return db.insert(storeMediaGcOutbox).values({
    id: ulid(),
    storageKey,
    attempts: 0,
    nextAttemptAt: now,
    lastError: null,
    createdAt: now,
  });
}

/** Consume the verified intent as part of the deletion batch. */
function consumeIntent(db: Db, tokenHash: string, now: Date): DbBatchItem {
  return db
    .update(storeOperatorDeletionIntent)
    .set({ consumedAt: now })
    .where(eq(storeOperatorDeletionIntent.tokenHash, tokenHash));
}

// ── Product release deletion ─────────────────────────────────────────────────

type ReleaseDeletion =
  | { kind: "gone" }
  | { kind: "replacement_gone" }
  | {
      kind: "ok";
      impact: DeletionImpact;
      isActive: boolean;
      replacementReleaseId: string | null;
      activeVersionAfter: string | null;
    };

async function deriveReleaseDeletion(db: Db, subject: ReleaseSubject): Promise<ReleaseDeletion> {
  const [product] = await db
    .select({ id: productBase.id, activeReleaseId: productBase.activeReleaseId })
    .from(productBase)
    .where(eq(productBase.id, subject.productId))
    .limit(1);
  if (!product) return { kind: "gone" };
  const [target] = await db
    .select({ id: productRelease.id, version: productRelease.version })
    .from(productRelease)
    .where(
      and(
        eq(productRelease.id, subject.releaseId),
        eq(productRelease.productId, subject.productId),
      ),
    )
    .limit(1);
  if (!target) return { kind: "gone" };

  let replacementVersion: string | null = null;
  if (subject.replacementReleaseId !== null) {
    const [rep] = await db
      .select({ version: productRelease.version })
      .from(productRelease)
      .where(
        and(
          eq(productRelease.id, subject.replacementReleaseId),
          eq(productRelease.productId, subject.productId),
        ),
      )
      .limit(1);
    if (!rep) return { kind: "replacement_gone" };
    replacementVersion = rep.version;
  }

  const [riAgg] = await db
    .select({ n: count() })
    .from(productReleaseImage)
    .where(eq(productReleaseImage.releaseId, subject.releaseId));
  const releaseImages = riAgg?.n ?? 0;

  const isActive = product.activeReleaseId === subject.releaseId;
  let activeVersionAfter: string | null;
  if (isActive) {
    activeVersionAfter = replacementVersion;
  } else if (product.activeReleaseId) {
    const [cur] = await db
      .select({ version: productRelease.version })
      .from(productRelease)
      .where(eq(productRelease.id, product.activeReleaseId))
      .limit(1);
    activeVersionAfter = cur?.version ?? null;
  } else {
    activeVersionAfter = null;
  }

  const warnings: string[] = [];
  if (isActive && subject.replacementReleaseId === null) {
    warnings.push("Deleting the active release with no replacement marks the product unavailable.");
  }

  const impact: DeletionImpact = {
    targetType: "product_release",
    targetId: subject.releaseId,
    label: target.version,
    activeReleaseAffected: isActive,
    deleteCounts: { releases: 1, releaseImages },
    retainedCounts: {},
    warnings,
  };
  return {
    kind: "ok",
    impact,
    isActive,
    replacementReleaseId: subject.replacementReleaseId,
    activeVersionAfter,
  };
}

export async function planProductReleaseDeletion(
  db: Db,
  call: Call<"planProductReleaseDeletion">,
): Res<"planProductReleaseDeletion"> {
  const { input, meta } = call;
  const [product] = await db
    .select({ id: productBase.id })
    .from(productBase)
    .where(eq(productBase.id, input.productId))
    .limit(1);
  if (!product) return err("not_found");
  const [target] = await db
    .select({ id: productRelease.id })
    .from(productRelease)
    .where(
      and(eq(productRelease.id, input.releaseId), eq(productRelease.productId, input.productId)),
    )
    .limit(1);
  if (!target) return err("not_found");

  const replacementReleaseId = input.replacementReleaseId ?? null;
  if (replacementReleaseId !== null) {
    if (replacementReleaseId === input.releaseId) return err("invalid_replacement");
    const [rep] = await db
      .select({ id: productRelease.id })
      .from(productRelease)
      .where(
        and(
          eq(productRelease.id, replacementReleaseId),
          eq(productRelease.productId, input.productId),
        ),
      )
      .limit(1);
    if (!rep) return err("invalid_replacement");
  }

  const subject: ReleaseSubject = {
    productId: input.productId,
    releaseId: input.releaseId,
    replacementReleaseId,
  };
  const derived = await deriveReleaseDeletion(db, subject);
  if (derived.kind !== "ok") return err("not_found");
  return ok(await writeDeletionPlan(db, meta, "deleteProductRelease", subject, derived.impact));
}

export async function deleteProductRelease(
  db: Db,
  call: Call<"deleteProductRelease">,
): Res<"deleteProductRelease"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ deleted: true; activeVersion: string | null }>(
    db,
    meta,
    "deleteProductRelease",
  );
  if (replay) return ok(replay);

  const verified = await verifyDeletionIntent<ReleaseSubject>(
    db,
    input.confirmationToken,
    meta.actor.sub,
    "deleteProductRelease",
    Date.now(),
  );
  if (!verified.ok) return err(verified.error);

  const derived = await deriveReleaseDeletion(db, verified.subject);
  if (derived.kind === "gone") return err("not_found");
  if (derived.kind === "replacement_gone") return err("deletion_plan_mismatch");
  if ((await impactHashOf(derived.impact)) !== verified.impactHash) {
    return err("deletion_plan_mismatch");
  }

  const now = new Date();
  const { productId, releaseId } = verified.subject;
  const value = { deleted: true as const, activeVersion: derived.activeVersionAfter };
  const statements: DbBatchItem[] = [];
  if (derived.isActive) {
    // Repoint (or clear) the public pointer BEFORE the release row is removed.
    const set: Partial<typeof productBase.$inferInsert> =
      derived.replacementReleaseId !== null
        ? { activeReleaseId: derived.replacementReleaseId, updatedAt: now }
        : { activeReleaseId: null, status: "unavailable", updatedAt: now };
    statements.push(db.update(productBase).set(set).where(eq(productBase.id, productId)));
  }
  statements.push(
    db.delete(productReleaseImage).where(eq(productReleaseImage.releaseId, releaseId)),
    db.delete(productRelease).where(eq(productRelease.id, releaseId)),
    consumeIntent(db, verified.tokenHash, now),
    eventInsert(
      db,
      meta,
      "deleteProductRelease",
      {
        targetType: "product_release",
        targetId: releaseId,
        detail: {
          productId,
          activeReleaseAffected: derived.isActive,
          replaced: derived.replacementReleaseId !== null,
          ...derived.impact.deleteCounts,
        },
      },
      value,
    ),
  );
  await runBatch(db, statements);
  return ok(value);
}

// ── Product (aggregate) deletion ─────────────────────────────────────────────

interface ProductDeletion {
  impact: DeletionImpact;
  releaseIds: string[];
  imageKeys: Array<{ storageKey: string }>;
}

async function deriveProductDeletion(
  db: Db,
  subject: ProductSubject,
): Promise<ProductDeletion | null> {
  const [product] = await db
    .select({
      id: productBase.id,
      slug: productBase.slug,
      activeReleaseId: productBase.activeReleaseId,
      title: productDraft.title,
    })
    .from(productBase)
    .innerJoin(productDraft, eq(productDraft.productId, productBase.id))
    .where(eq(productBase.id, subject.productId))
    .limit(1);
  if (!product) return null;

  const releases = await db
    .select({ id: productRelease.id })
    .from(productRelease)
    .where(eq(productRelease.productId, subject.productId));
  const releaseIds = releases.map((r) => r.id);
  const imageKeys = await db
    .select({ storageKey: productImage.storageKey })
    .from(productImage)
    .where(eq(productImage.productId, subject.productId));
  const [variantAgg] = await db
    .select({ n: count() })
    .from(productVariant)
    .where(eq(productVariant.productId, subject.productId));
  let releaseImages = 0;
  if (releaseIds.length) {
    const [ri] = await db
      .select({ n: count() })
      .from(productReleaseImage)
      .where(inArray(productReleaseImage.releaseId, releaseIds));
    releaseImages = ri?.n ?? 0;
  }
  // Snapshot order references (never touched — INV-DEL-2); the counts fold into
  // the impact hash, so a new order between plan and confirm is drift.
  const [orderAgg] = await db
    .select({ orders: countDistinct(orderItem.orderId), items: count() })
    .from(orderItem)
    .where(eq(orderItem.productId, subject.productId));
  const orders = orderAgg?.orders ?? 0;
  const orderItems = orderAgg?.items ?? 0;

  const warnings: string[] = [];
  if (orders > 0) {
    warnings.push(`Referenced by ${orders} order(s); order history is retained, not deleted.`);
  }
  if (product.activeReleaseId) warnings.push("The active release will be removed.");

  const impact: DeletionImpact = {
    targetType: "product",
    targetId: subject.productId,
    label: product.title ?? product.slug,
    activeReleaseAffected: product.activeReleaseId !== null,
    deleteCounts: {
      drafts: 1,
      releases: releaseIds.length,
      releaseImages,
      variants: variantAgg?.n ?? 0,
      images: imageKeys.length,
    },
    retainedCounts: { orders, orderItems },
    warnings,
  };
  return { impact, releaseIds, imageKeys };
}

export async function planProductDeletion(
  db: Db,
  call: Call<"planProductDeletion">,
): Res<"planProductDeletion"> {
  const { input, meta } = call;
  const data = await deriveProductDeletion(db, { productId: input.productId });
  if (!data) return err("not_found");
  return ok(
    await writeDeletionPlan(db, meta, "deleteProduct", { productId: input.productId }, data.impact),
  );
}

export async function deleteProduct(db: Db, call: Call<"deleteProduct">): Res<"deleteProduct"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ deleted: true }>(db, meta, "deleteProduct");
  if (replay) return ok(replay);

  const verified = await verifyDeletionIntent<ProductSubject>(
    db,
    input.confirmationToken,
    meta.actor.sub,
    "deleteProduct",
    Date.now(),
  );
  if (!verified.ok) return err(verified.error);

  const data = await deriveProductDeletion(db, verified.subject);
  if (!data) return err("not_found");
  if ((await impactHashOf(data.impact)) !== verified.impactHash) {
    return err("deletion_plan_mismatch");
  }

  const now = new Date();
  const { productId } = verified.subject;
  const value = { deleted: true as const };
  // Explicit ordered child removal then the aggregate — never relying on FK
  // cascade alone. The active pointer is cleared first (it references a release
  // deleted below); order_item is deliberately absent from this batch.
  const statements: DbBatchItem[] = [
    db
      .update(productBase)
      .set({ activeReleaseId: null, updatedAt: now })
      .where(eq(productBase.id, productId)),
  ];
  if (data.releaseIds.length) {
    statements.push(
      db.delete(productReleaseImage).where(inArray(productReleaseImage.releaseId, data.releaseIds)),
    );
  }
  statements.push(
    db.delete(productVariant).where(eq(productVariant.productId, productId)),
    db.delete(productImage).where(eq(productImage.productId, productId)),
    db.delete(productRelease).where(eq(productRelease.productId, productId)),
    db.delete(productDraft).where(eq(productDraft.productId, productId)),
    db.delete(productBase).where(eq(productBase.id, productId)),
  );
  for (const img of data.imageKeys) statements.push(gcOutboxInsert(db, img.storageKey, now));
  statements.push(
    consumeIntent(db, verified.tokenHash, now),
    eventInsert(
      db,
      meta,
      "deleteProduct",
      {
        targetType: "product",
        targetId: productId,
        detail: { ...data.impact.deleteCounts, retained: data.impact.retainedCounts },
      },
      value,
    ),
  );
  await runBatch(db, statements);
  return ok(value);
}

// ── Variant deletion ─────────────────────────────────────────────────────────

async function deriveVariantDeletion(
  db: Db,
  subject: VariantSubject,
): Promise<{ impact: DeletionImpact } | null> {
  const [variant] = await db
    .select({ id: productVariant.id, size: productVariant.size, sku: productVariant.sku })
    .from(productVariant)
    .where(
      and(
        eq(productVariant.id, subject.variantId),
        eq(productVariant.productId, subject.productId),
      ),
    )
    .limit(1);
  if (!variant) return null;
  const [orderAgg] = await db
    .select({ orders: countDistinct(orderItem.orderId), items: count() })
    .from(orderItem)
    .where(eq(orderItem.variantId, subject.variantId));
  const orders = orderAgg?.orders ?? 0;
  const orderItems = orderAgg?.items ?? 0;

  const warnings: string[] = [];
  if (orders > 0) {
    warnings.push(
      `Referenced by ${orders} order(s); stale browser carts will fail checkout availability.`,
    );
  }

  const impact: DeletionImpact = {
    targetType: "product_variant",
    targetId: subject.variantId,
    label: `${variant.size} (${variant.sku})`,
    activeReleaseAffected: false,
    deleteCounts: { variants: 1 },
    retainedCounts: { orders, orderItems },
    warnings,
  };
  return { impact };
}

export async function planVariantDeletion(
  db: Db,
  call: Call<"planVariantDeletion">,
): Res<"planVariantDeletion"> {
  const { input, meta } = call;
  const data = await deriveVariantDeletion(db, {
    productId: input.productId,
    variantId: input.variantId,
  });
  if (!data) return err("not_found");
  const subject: VariantSubject = { productId: input.productId, variantId: input.variantId };
  return ok(await writeDeletionPlan(db, meta, "deleteVariant", subject, data.impact));
}

export async function deleteVariant(db: Db, call: Call<"deleteVariant">): Res<"deleteVariant"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ deleted: true }>(db, meta, "deleteVariant");
  if (replay) return ok(replay);

  const verified = await verifyDeletionIntent<VariantSubject>(
    db,
    input.confirmationToken,
    meta.actor.sub,
    "deleteVariant",
    Date.now(),
  );
  if (!verified.ok) return err(verified.error);

  const data = await deriveVariantDeletion(db, verified.subject);
  if (!data) return err("not_found");
  if ((await impactHashOf(data.impact)) !== verified.impactHash) {
    return err("deletion_plan_mismatch");
  }

  const now = new Date();
  const { productId, variantId } = verified.subject;
  const value = { deleted: true as const };
  // Only the variant row — order_item lines that snapshot this variant are
  // never touched (INV-DEL-2).
  await runBatch(db, [
    db.delete(productVariant).where(eq(productVariant.id, variantId)),
    consumeIntent(db, verified.tokenHash, now),
    eventInsert(
      db,
      meta,
      "deleteVariant",
      { targetType: "product_variant", targetId: variantId, detail: { productId } },
      value,
    ),
  ]);
  return ok(value);
}

// ── Product media deletion ───────────────────────────────────────────────────

async function deriveMediaDeletion(
  db: Db,
  subject: MediaSubject,
): Promise<{ impact: DeletionImpact; storageKey: string; productStatus: ProductStatus } | null> {
  const [image] = await db
    .select({
      id: productImage.id,
      storageKey: productImage.storageKey,
      alt: productImage.alt,
      role: productImage.role,
    })
    .from(productImage)
    .where(and(eq(productImage.id, subject.mediaId), eq(productImage.productId, subject.productId)))
    .limit(1);
  if (!image) return null;
  const [product] = await db
    .select({ activeReleaseId: productBase.activeReleaseId, status: productBase.status })
    .from(productBase)
    .where(eq(productBase.id, subject.productId))
    .limit(1);
  if (!product) return null;

  const [riAgg] = await db
    .select({ n: count() })
    .from(productReleaseImage)
    .where(eq(productReleaseImage.imageId, subject.mediaId));
  const releaseImages = riAgg?.n ?? 0;

  let activeReleaseAffected = false;
  if (product.activeReleaseId) {
    const [inActive] = await db
      .select({ imageId: productReleaseImage.imageId })
      .from(productReleaseImage)
      .where(
        and(
          eq(productReleaseImage.releaseId, product.activeReleaseId),
          eq(productReleaseImage.imageId, subject.mediaId),
        ),
      )
      .limit(1);
    activeReleaseAffected = !!inActive;
  }

  const warnings: string[] = [];
  if (activeReleaseAffected) {
    warnings.push("This image is part of the current active release snapshot.");
  }

  const impact: DeletionImpact = {
    targetType: "media",
    targetId: subject.mediaId,
    label: `${image.role}: ${image.alt}`,
    activeReleaseAffected,
    deleteCounts: { images: 1, releaseImages },
    retainedCounts: {},
    warnings,
  };
  return { impact, storageKey: image.storageKey, productStatus: product.status };
}

export async function planProductMediaDeletion(
  db: Db,
  call: Call<"planProductMediaDeletion">,
): Res<"planProductMediaDeletion"> {
  const { input, meta } = call;
  const data = await deriveMediaDeletion(db, {
    productId: input.productId,
    mediaId: input.mediaId,
  });
  if (!data) return err("not_found");
  const subject: MediaSubject = { productId: input.productId, mediaId: input.mediaId };
  return ok(await writeDeletionPlan(db, meta, "deleteProductMedia", subject, data.impact));
}

export async function deleteProductMedia(
  db: Db,
  call: Call<"deleteProductMedia">,
): Res<"deleteProductMedia"> {
  const { input, meta } = call;
  const replay = await recordedResponse<{ deleted: true; productStatus: ProductStatus }>(
    db,
    meta,
    "deleteProductMedia",
  );
  if (replay) return ok(replay);

  const verified = await verifyDeletionIntent<MediaSubject>(
    db,
    input.confirmationToken,
    meta.actor.sub,
    "deleteProductMedia",
    Date.now(),
  );
  if (!verified.ok) return err(verified.error);

  const data = await deriveMediaDeletion(db, verified.subject);
  if (!data) return err("not_found");
  if ((await impactHashOf(data.impact)) !== verified.impactHash) {
    return err("deletion_plan_mismatch");
  }

  const now = new Date();
  const { productId, mediaId } = verified.subject;
  const value = { deleted: true as const, productStatus: data.productStatus };
  // Logical media delete + physical-byte GC outbox insert commit atomically;
  // the release-image joins for this image are removed explicitly first.
  await runBatch(db, [
    db.delete(productReleaseImage).where(eq(productReleaseImage.imageId, mediaId)),
    db.delete(productImage).where(eq(productImage.id, mediaId)),
    gcOutboxInsert(db, data.storageKey, now),
    consumeIntent(db, verified.tokenHash, now),
    eventInsert(
      db,
      meta,
      "deleteProductMedia",
      {
        targetType: "media",
        targetId: mediaId,
        detail: { productId, ...data.impact.deleteCounts },
      },
      value,
    ),
  ]);
  return ok(value);
}
