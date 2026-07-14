// Storefront schema. All timestamps are unix milliseconds. User ids are bare
// `text` columns holding bouncer user ids — this app owns no auth tables
// (cross-subdomain SSO via bouncer; see docs/adding-an-app.md §2).
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { ORDER_STATUSES, PRODUCT_STATUSES } from "@/lib/config";

// ── Catalog ────────────────────────────────────────────────────────────────

// A sellable product (a T-shirt design). Admin-managed.
export const product = sqliteTable(
  "product",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(), // url key, e.g. "heavyweight-black-tee"
    title: text("title").notNull(),
    description: text("description"), // markdown / plain
    priceCents: integer("price_cents").notNull().default(0),
    // draft = hidden from storefront; active = listed; archived = soft-retired.
    status: text("status", { enum: PRODUCT_STATUSES }).notNull().default("draft"),
    createdBy: text("created_by").notNull(), // bouncer admin user id
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_product_status").on(t.status)],
);

// Product images live in R2 via Roadie; we store the Roadie reference id and
// serve bytes through /api/img/$refId (302 to a signed URL). `position` orders
// the gallery; position 0 is the cover.
export const productImage = sqliteTable(
  "product_image",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
    roadieReferenceId: text("roadie_reference_id").notNull(),
    alt: text("alt"),
    position: integer("position").notNull().default(0),
    // null until the browser PUT + finalize round-trip completes.
    uploadedAt: integer("uploaded_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [index("idx_image_product").on(t.productId, t.position)],
);

// A purchasable variant of a product — a size, with its own SKU and stock.
export const productVariant = sqliteTable(
  "product_variant",
  {
    id: text("id").primaryKey(),
    productId: text("product_id")
      .notNull()
      .references(() => product.id, { onDelete: "cascade" }),
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
// edits never rewrite a customer's order history.
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

export type Product = typeof product.$inferSelect;
export type ProductImage = typeof productImage.$inferSelect;
export type ProductVariant = typeof productVariant.$inferSelect;
export type CustomerOrder = typeof customerOrder.$inferSelect;
export type OrderItem = typeof orderItem.$inferSelect;
export type ProcessedStripeEvent = typeof processedStripeEvent.$inferSelect;
export type DeadStripeEvent = typeof deadStripeEvent.$inferSelect;
