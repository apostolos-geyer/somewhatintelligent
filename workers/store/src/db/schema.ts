// Storefront schema. All timestamps are unix milliseconds. User ids are bare
// `text` columns holding bouncer/Access subjects — this app owns no auth tables
// (cross-subdomain SSO via bouncer; see docs/adding-an-app.md §2).
//
// The product aggregate follows the RFC-0001 "Store D1 catalog revisions"
// release model: a thin `product` identity row, an editable `product_draft`
// working copy, immutable-while-retained `product_release` snapshots, and
// storage-neutral `product_image` rows (`product_release_image` freezes the
// image set at publish). The live domain tables (`product_variant`,
// `customer_order`, `order_item`, the Stripe ledgers) are unchanged.
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  sqliteView,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { eq, sql } from "drizzle-orm";

// Status domains are defined locally rather than imported from lib/config.ts:
// config.ts reads `import.meta.env.STORE_LIVE` at module load, which the
// drizzle-kit CJS loader cannot provide (db:generate would throw). Keep these in
// sync with lib/config.ts.
//   • ORDER_STATUSES mirrors lib/config.ts exactly (type-only; no DB CHECK).
//   • PRODUCT_STATUSES is the RFC-0001 release-model set — it adds 'unavailable'
//     to the pre-release draft/active/archived that lib/config.ts still lists
//     (T11 widens config; the DB CHECK below is the authoritative domain).
const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;
const PRODUCT_STATUSES = ["draft", "active", "unavailable", "archived"] as const;

// Product-image classification + upload lifecycle. These are the DB CHECK
// domains for `product_image.role` / `.state`; the frozen release snapshot
// (`product_release_image`) copies `role` as free text, never re-validated.
export const PRODUCT_IMAGE_ROLES = ["cover", "gallery", "evidence"] as const;
export type ProductImageRole = (typeof PRODUCT_IMAGE_ROLES)[number];
export const PRODUCT_IMAGE_STATES = ["pending", "ready", "failed"] as const;
export type ProductImageState = (typeof PRODUCT_IMAGE_STATES)[number];

// ── Catalog: release model ───────────────────────────────────────────────────

// Product identity. Thin by design: copy, price, and media live in the draft /
// release rows. `active_release_id` points at the live immutable release (null
// while draft-only or after the active release is deleted). Status admits
// 'unavailable' (published but temporarily not for sale) alongside the RFC set.
export const productBase = sqliteTable(
  "product",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    status: text("status", { enum: PRODUCT_STATUSES }).notNull().default("draft"),
    // Forward reference to product_release (declared below) — the return type is
    // annotated to break the product ↔ product_release circular FK inference.
    activeReleaseId: text("active_release_id").references(
      (): AnySQLiteColumn => productRelease.id,
      {
        onDelete: "set null",
      },
    ),
    createdBySub: text("created_by_sub").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("idx_product_status_updated").on(t.status, t.updatedAt),
    check("product_status_valid", sql`status IN ('draft', 'active', 'unavailable', 'archived')`),
  ],
);

// Editable working copy — exactly one per product, replaced in place on each
// autosave. `revision` bumps monotonically; publish snapshots this into a
// release. Never read by public/checkout paths (those read the active release).
export const productDraft = sqliteTable(
  "product_draft",
  {
    productId: text("product_id")
      .primaryKey()
      .references(() => productBase.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    descriptionMarkdown: text("description_markdown"),
    priceCents: integer("price_cents").notNull(),
    updatedBySub: text("updated_by_sub").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  () => [
    check("product_draft_revision_min", sql`revision >= 1`),
    check("product_draft_price_non_negative", sql`price_cents >= 0`),
  ],
);

// Immutable-while-retained published snapshot. Checkout/public reads source
// title + price from the product's active release. Deletable (a release may be
// removed), but never mutated in place — hence UNIQUE(product_id, version).
export const productRelease = sqliteTable(
  "product_release",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => productBase.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    descriptionMarkdown: text("description_markdown"),
    priceCents: integer("price_cents").notNull(),
    publishedBySub: text("published_by_sub").notNull(),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("product_release_product_version_unique").on(t.productId, t.version),
    check("product_release_price_non_negative", sql`price_cents >= 0`),
  ],
);

// Storage-neutral product media. `storage_key` is the opaque key the private
// MediaStorage port returns from put() — never a Roadie referenceId, never a
// public URL (INV-MEDIA-1). `state` gates eligibility: only 'ready' rows serve.
export const productImage = sqliteTable(
  "product_image",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => productBase.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    contentSha256: text("content_sha256").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    alt: text("alt").notNull(),
    role: text("role", { enum: PRODUCT_IMAGE_ROLES }).notNull(),
    position: integer("position").notNull().default(0),
    state: text("state", { enum: PRODUCT_IMAGE_STATES }).notNull().default("pending"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    readyAt: integer("ready_at", { mode: "timestamp_ms" }),
  },
  (t) => [
    index("idx_product_image_product").on(t.productId, t.position),
    check("product_image_role_valid", sql`role IN ('cover', 'gallery', 'evidence')`),
    check("product_image_state_valid", sql`state IN ('pending', 'ready', 'failed')`),
    check("product_image_size_non_negative", sql`size_bytes >= 0`),
  ],
);

// Frozen image set for a release: a copy of the ready images (with their alt /
// role / position) at publish time, so later media edits never rewrite a
// published snapshot. Both sides cascade so deleting a release or a source
// image removes the join row.
export const productReleaseImage = sqliteTable(
  "product_release_image",
  {
    releaseId: text("release_id")
      .notNull()
      .references(() => productRelease.id, { onDelete: "cascade" }),
    imageId: text("image_id")
      .notNull()
      .references(() => productImage.id, { onDelete: "cascade" }),
    alt: text("alt").notNull(),
    role: text("role").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [primaryKey({ columns: [t.releaseId, t.imageId] })],
);

// Backward-compatible read view of the pre-release flat `product` shape, joining
// the identity row to its draft (title/description/price). It exists ONLY so the
// pre-release read paths (checkout re-pricing, order placement, admin catalog)
// keep compiling and behaving while T9/T10 repoint them at the active release;
// it carries no writes. Every product created in the new model has a draft, so
// the inner join never drops a row. Removed once the release repoint lands.
export const product = sqliteView("product_flat").as((qb) =>
  qb
    .select({
      id: productBase.id,
      slug: productBase.slug,
      title: productDraft.title,
      description: productDraft.descriptionMarkdown,
      priceCents: productDraft.priceCents,
      status: productBase.status,
      createdBy: productBase.createdBySub,
      createdAt: productBase.createdAt,
      updatedAt: productBase.updatedAt,
    })
    .from(productBase)
    .innerJoin(productDraft, eq(productBase.id, productDraft.productId)),
);

// A purchasable variant of a product — a size, with its own SKU and stock.
// Live domain state (unchanged by the release model): the non-negative stock
// check and the unique SKU / (product, size) constraints stay mandatory.
export const productVariant = sqliteTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => productBase.id, { onDelete: "cascade" }),
    size: text("size").notNull(), // S / M / L / XL ...
    sku: text("sku").notNull().unique(),
    stock: integer("stock").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("idx_variant_product").on(t.productId),
    uniqueIndex("idx_variant_product_size").on(t.productId, t.size),
    // Negative stock is unrepresentable. The reservation guard (WHERE stock >=
    // qty) stays the concurrency mechanism; this backstops any unguarded write.
    check("stock_non_negative", sql`stock >= 0`),
  ],
);

// ── Orders & fulfillment ─────────────────────────────────────────────────────

// Named `customer_order` to dodge the `order` SQL keyword. One shipment per
// order (it's a T-shirt shop). `status` is the combined order + fulfillment
// lifecycle; the tracking fields drive the customer-facing shipment view.
export const customerOrder = sqliteTable(
  "customer_order",
  {
    id: text("id").primaryKey(),
    orderNumber: text("order_number").notNull().unique(), // human handle, e.g. AT-7Q2K9
    userId: text("user_id").notNull(), // bouncer buyer id
    email: text("email").notNull(),
    status: text("status", { enum: ORDER_STATUSES }).notNull().default("pending"),
    // Shipping address snapshot. Nullable because the embedded Stripe checkout
    // collects the address during payment (ShippingAddressElement) — the order
    // is created before Stripe returns it, and the completed webhook / heal
    // sweep backfills these columns. shipCountry keeps its notNull "CA" default.
    shipName: text("ship_name"),
    shipLine1: text("ship_line1"),
    shipLine2: text("ship_line2"),
    shipCity: text("ship_city"),
    shipRegion: text("ship_region"),
    shipPostal: text("ship_postal"),
    shipCountry: text("ship_country").notNull().default("CA"),
    shipPhone: text("ship_phone"),
    // Money (integer cents, CAD).
    subtotalCents: integer("subtotal_cents").notNull(),
    shippingCents: integer("shipping_cents").notNull().default(0),
    totalCents: integer("total_cents").notNull(),
    // Stripe linkage. Nullable so the no-Stripe manual stub remains usable in
    // keyless dev/CI; populated when Checkout Sessions are enabled.
    stripeCustomerId: text("stripe_customer_id"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    // Set alongside stripeCheckoutSessionId, immediately after Stripe returns the
    // Session. Mirrors the Session's own `expires_at` (epoch seconds → ms here).
    // Used by the reconciliation cron (Track D5/D6) to find stale-attached
    // reservations without an unbounded Stripe API scan.
    stripeSessionExpiresAt: integer("stripe_session_expires_at", { mode: "timestamp_ms" }),
    paymentStatus: text("payment_status").notNull().default("unpaid"),
    // Fulfillment / tracking.
    carrier: text("carrier"), // CarrierKey from lib/config.ts
    trackingNumber: text("tracking_number"),
    fulfillmentNote: text("fulfillment_note"),
    shippedAt: integer("shipped_at", { mode: "timestamp_ms" }),
    deliveredAt: integer("delivered_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    index("idx_order_user").on(t.userId, t.createdAt),
    index("idx_order_status").on(t.status),
    index("idx_order_stripe_customer").on(t.stripeCustomerId),
    // Address atomicity: the core address group is either wholly collected or
    // wholly absent — a half-written address is unrepresentable. (shipCountry
    // keeps its own "CA" default; shipLine2/shipPhone are independently optional.)
    check(
      "ship_address_atomic",
      sql`(ship_name IS NULL) = (ship_line1 IS NULL) AND (ship_name IS NULL) = (ship_city IS NULL) AND (ship_name IS NULL) = (ship_region IS NULL) AND (ship_name IS NULL) = (ship_postal IS NULL)`,
    ),
  ],
);

// Idempotency ledger for Stripe webhook events processed by the queue
// consumer. Event ids are globally unique in Stripe and are the only durable
// replay key we trust.
export const processedStripeEvent = sqliteTable("processed_stripe_event", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull(),
});

// Dead-letter forensics for Stripe events the terminal DLQ consumer could not
// recover. The money invariant — a captured charge always terminates as a paid
// order or a deliberate refund, never silently neither — needs the DLQ ack to
// leave durable evidence behind: when a DLQ message reprocesses to `retryable`
// (no matching order yet) or throws, its compacted payload is persisted here
// BEFORE the (unconditional) ack, so a stuck payment surfaces in a query
// instead of ageing out of the queue. The reconcile cron stamps `resolvedAt`
// once it heals (paid) or releases the matching order (see reconcile.ts). One
// row per Stripe event id; a redelivery bumps `lastSeenAt`/`attempts`.
export const deadStripeEvent = sqliteTable("dead_stripe_event", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  objectId: text("object_id"), // checkout session id, when the event carried one
  metadataOrderId: text("metadata_order_id"),
  payload: text("payload").notNull(), // compacted StoreStripeEventMessage JSON
  attempts: integer("attempts"),
  // 'retryable_exhausted' (reprocess still finds no order) | 'reprocess_threw'.
  reason: text("reason").notNull(),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp_ms" }).notNull(),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }).notNull(),
  // Null until the reconcile cron heals or releases the matching order.
  resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
});

// Line items — snapshot title/size/price at purchase time so later catalog
// edits never rewrite a customer's order history. Deliberately NO catalog FK:
// deleting a product/release never cascades into order history (INV-ORDER-1).
export const orderItem = sqliteTable(
  "order_item",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => customerOrder.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").notNull(),
    titleSnapshot: text("title_snapshot").notNull(),
    sizeSnapshot: text("size_snapshot").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
  },
  (t) => [index("idx_item_order").on(t.orderId)],
);

// ── Operator audit + deletion + media GC (RFC-0001) ──────────────────────────

// One idempotent row per operator mutation. UNIQUE(idempotency_key, action)
// makes a replayed command a no-op; `response_json` lets the replay return the
// original response (INV-AUDIT-1).
export const storeOperatorEvent = sqliteTable(
  "store_operator_event",
  {
    id: text("id").primaryKey(),
    operatorSub: text("operator_sub").notNull(),
    operatorEmail: text("operator_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    detailJson: text("detail_json"),
    responseJson: text("response_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("store_operator_event_idempotency_action_unique").on(t.idempotencyKey, t.action),
  ],
);

// Short-lived deletion plan. Stores only a token hash + an impact hash; at
// execution the owning service re-verifies subject/action/target/expiry/impact
// before consuming (`consumed_at`). No dependency graph is persisted here.
export const storeOperatorDeletionIntent = sqliteTable("store_operator_deletion_intent", {
  tokenHash: text("token_hash").primaryKey(),
  operatorSub: text("operator_sub").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  impactHash: text("impact_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  consumedAt: integer("consumed_at", { mode: "timestamp_ms" }),
});

// Async physical-byte cleanup queue. A logical media delete commits atomically
// with an outbox row; a retryable drain (alongside the reconcile cron) deletes
// the bytes. A failed cleanup never resurfaces the deleted logical record.
export const storeMediaGcOutbox = sqliteTable("store_media_gc_outbox", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at", { mode: "timestamp_ms" }).notNull(),
  lastError: text("last_error"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export type ProductBase = typeof productBase.$inferSelect;
export type ProductDraft = typeof productDraft.$inferSelect;
export type ProductRelease = typeof productRelease.$inferSelect;
export type ProductImage = typeof productImage.$inferSelect;
export type ProductReleaseImage = typeof productReleaseImage.$inferSelect;
export type Product = typeof product.$inferSelect; // compat read view (flat pre-release row)
export type ProductVariant = typeof productVariant.$inferSelect;
export type CustomerOrder = typeof customerOrder.$inferSelect;
export type OrderItem = typeof orderItem.$inferSelect;
export type ProcessedStripeEvent = typeof processedStripeEvent.$inferSelect;
export type DeadStripeEvent = typeof deadStripeEvent.$inferSelect;
export type StoreOperatorEvent = typeof storeOperatorEvent.$inferSelect;
export type StoreOperatorDeletionIntent = typeof storeOperatorDeletionIntent.$inferSelect;
export type StoreMediaGcOutbox = typeof storeMediaGcOutbox.$inferSelect;
