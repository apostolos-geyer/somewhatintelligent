// Request-path core of the embedded Payment Element checkout, extracted from
// the server-fn wrapper (checkout.functions.ts) so the D1 write path is
// unit/pool-testable without the TanStack server-fn runtime — same split as
// pricing.ts / reservation.ts. The Stripe API call and Stripe-Customer
// resolution are injected (StripeSessionCreator / EnsureCustomer) so the pool
// tier drives this against a real D1 with both mocked. Stripe appears only as a
// type here (`import type`) — the client is constructed in the wrapper.
import type Stripe from "stripe";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { customerOrder, orderItem, product, productVariant } from "@/db/schema";
import type { Db } from "@/lib/db";
import { ulid } from "@somewhatintelligent/kit/ids";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { computeOrderTotals, type OrderLine } from "@/lib/pricing";
import { reserveStock } from "@/lib/reservation";
import { releaseAndCancel } from "@/lib/reconcile";
import type { OrderStatus } from "@/lib/config";
import { stripeConfigured } from "@somewhatintelligent/stripe";

// Stripe's documented minimum session lifetime; bounds the stock-reservation
// window (Track A4/D4) to something a buyer finishes an in-page checkout within.
const CHECKOUT_SESSION_TTL_SECONDS = 30 * 60;

function orderNumber(): string {
  return `SI-${ulid().slice(-6).toUpperCase()}`;
}

// The cart shape createCheckoutSession accepts — structurally the same as
// placeOrder's arktype input, kept as a plain type so this module carries no
// server-fn/validation dependency.
export interface CheckoutInput {
  items: { variantId: string; quantity: number }[];
  shipping: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postal: string;
    country?: string;
    phone?: string;
  };
}

type CheckoutError =
  | "empty_cart"
  | "variant_not_found"
  | "product_unavailable"
  | "out_of_stock"
  | "stripe_customer_failed"
  | "stripe_session_failed";

export type CreateCheckoutSessionResult =
  | { ok: true; mode: "stub" }
  | { ok: true; mode: "elements"; clientSecret: string; orderNumber: string }
  | { ok: false; error: CheckoutError; message?: string };

// Cross-user or unknown lookups collapse to `not_found` (Resolved decision 2):
// never confirm a session id maps to someone's order.
export type OrderByStripeSessionResult =
  | { ok: true; orderNumber: string; status: OrderStatus; paymentStatus: string }
  | { ok: false; error: "not_found" };

export type EnsureCustomerResult = { ok: true; stripeCustomerId: string } | { ok: false };
export type EnsureCustomer = () => Promise<EnsureCustomerResult>;

// The pinned runtime API version renamed the checkout ui_mode enum
// (custom→elements); stripe@20.4.1's bundled types predate the rename, so widen
// ui_mode here. The value is forwarded verbatim to the API and is correct for
// the version this client pins.
export type DahliaSessionCreateParams = Omit<Stripe.Checkout.SessionCreateParams, "ui_mode"> & {
  ui_mode: "elements";
};

export type CreatedCheckoutSession = Pick<
  Stripe.Checkout.Session,
  "id" | "client_secret" | "expires_at"
>;

export type StripeSessionCreator = (
  params: DahliaSessionCreateParams,
  options: { idempotencyKey: string },
) => Promise<CreatedCheckoutSession>;

// Injected `stripe.checkout.sessions.expire`. The authority for the supersede
// sweep (Track G3): Stripe only expires an OPEN session, so a resolved promise
// PROVES the session can never be paid, and a throw means it is not open
// (complete/already-expired — a paid webhook may be in flight).
export type SessionExpirer = (sessionId: string) => Promise<void>;

export interface CheckoutSessionDeps {
  db: Db;
  session: PlatformSession;
  input: CheckoutInput;
  // STORE_URL widened to string: wrangler types it as the literal union of the
  // deployed values, but the core only needs "a URL" (tests inject localhost).
  env: Pick<Env, "STRIPE_SECRET_KEY" | "STRIPE_WEBHOOK_SIGNING_SECRET"> & { STORE_URL: string };
  ensureCustomer: EnsureCustomer;
  createStripeSession: StripeSessionCreator;
  expireSession: SessionExpirer;
}

function buildSessionParams(opts: {
  customerId: string;
  lines: readonly OrderLine[];
  shippingCents: number;
  orderId: string;
  returnUrl: string;
}): DahliaSessionCreateParams {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    ui_mode: "elements",
    mode: "payment",
    customer: opts.customerId,
    // Line-item amounts are the D1-computed prices — no client-supplied amount
    // ever reaches Stripe (INV-1). Ad-hoc price_data, no managed Stripe Price
    // (Track B2).
    line_items: opts.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency: "cad",
        unit_amount: line.unitPriceCents,
        product_data: { name: `${line.title} (${line.size})` },
      },
    })),
    // Shipping rides shipping_options as a server-picked rate, never a line item
    // (Track B3) — calculateShipping stays the single shipping-cost authority.
    shipping_options: [
      {
        shipping_rate_data: {
          display_name: "Shipping",
          type: "fixed_amount",
          fixed_amount: { amount: opts.shippingCents, currency: "cad" },
        },
      },
    ],
    // Costs nothing now; prerequisite for a future Dashboard-only Stripe Tax
    // flip (Track A7).
    billing_address_collection: "auto",
    metadata: { orderId: opts.orderId },
    expires_at: nowSeconds + CHECKOUT_SESSION_TTL_SECONDS,
    return_url: opts.returnUrl,
  };
}

// Reverse a committed reservation synchronously (Track C3): re-increment each
// line's stock and cancel the order, in one batch. Knows the lines in memory,
// so no order_item re-read — cheaper than releaseStock, which the webhook/cron
// paths use instead.
async function reverseReservation(
  db: Db,
  orderId: string,
  lines: readonly OrderLine[],
): Promise<void> {
  const now = new Date();
  const statements = [
    ...lines.map((line) =>
      db
        .update(productVariant)
        .set({ stock: sql`${productVariant.stock} + ${line.quantity}` })
        .where(eq(productVariant.id, line.variantId)),
    ),
    db
      .update(customerOrder)
      .set({ status: "cancelled", updatedAt: now })
      .where(eq(customerOrder.id, orderId)),
  ];
  await db.batch(statements as never);
}

// At most one open checkout session per user (Track G3): before reserving stock
// for a new attempt, supersede the caller's prior open attempts so an abandoned
// session neither holds reserved stock for its full TTL nor stays payable at
// Stripe (a redirect method like Klarna leaves an abandoned session completable
// — a later double charge). Stripe is the release authority: `sessions.expire`
// only succeeds on an OPEN session, so a resolved expire PROVES the session can
// never be paid — only then is its reservation released+cancelled in one gated
// batch (reusing reconcile.ts's idiom exactly; the later checkout.session.expired
// webhook no-ops through the same gates, no ledger row written here). A throw
// means the session is not open (complete/already-expired — a paid webhook may
// be in flight), so the order is left COMPLETELY untouched for the webhook/cron
// to settle, never released on D1 state alone. Orphans (no session id) belong to
// the cron (Track D5/D6) and are excluded here. A supersede failure never fails
// the new checkout.
async function supersedePriorOpenAttempts(
  db: Db,
  userId: string,
  expireSession: SessionExpirer,
): Promise<void> {
  const priors = await db
    .select({ id: customerOrder.id, sessionId: customerOrder.stripeCheckoutSessionId })
    .from(customerOrder)
    .where(
      and(
        eq(customerOrder.userId, userId),
        eq(customerOrder.status, "pending"),
        inArray(customerOrder.paymentStatus, ["unpaid", "processing"]),
        isNotNull(customerOrder.stripeCheckoutSessionId),
      ),
    );

  for (const prior of priors) {
    const sessionId = prior.sessionId;
    if (!sessionId) continue;
    try {
      await expireSession(sessionId);
    } catch {
      // Not open at Stripe (complete/already-expired — a paid webhook may be in
      // flight). Leave the order untouched; the webhook/cron settles it.
      console.log("store.stripe_checkout.supersede_skipped", {
        order_id: prior.id,
        session_id: sessionId,
      });
      continue;
    }
    await db.batch(releaseAndCancel(db, prior.id, new Date()) as never);
    console.log("store.stripe_checkout.superseded", {
      order_id: prior.id,
      session_id: sessionId,
    });
  }
}

function stripeErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  if (err instanceof Error) return err.name;
  return "unknown";
}

/**
 * Request-path core of createCheckoutSession, with the Stripe call and customer
 * resolution injected so the D1 write path is exercisable against a real DB.
 * Ordering is load-bearing: gate → re-price → resolve customer → reserve+write
 * order (stripeCustomerId in the same insert, INV-11) → create Session →
 * attach session id (INV-2). Any post-reservation failure reverses the
 * reservation before returning (Track C3); no path throws on business logic.
 */
export async function createCheckoutSessionCore(
  deps: CheckoutSessionDeps,
): Promise<CreateCheckoutSessionResult> {
  const { db, session, input, env: cfg, ensureCustomer, createStripeSession, expireSession } = deps;

  // INV-7: unconfigured → zero D1 writes, zero Stripe calls; client falls back
  // to placeOrder.
  if (!stripeConfigured(cfg.STRIPE_SECRET_KEY, cfg.STRIPE_WEBHOOK_SIGNING_SECRET)) {
    return { ok: true, mode: "stub" };
  }

  // Re-price from the authoritative product/variant rows (INV-1).
  const variantIds = input.items.map((i) => i.variantId);
  const variants = await db
    .select()
    .from(productVariant)
    .where(inArray(productVariant.id, variantIds));
  const productIds = [...new Set(variants.map((v) => v.productId))];
  const products = productIds.length
    ? await db.select().from(product).where(inArray(product.id, productIds))
    : [];
  const priced = computeOrderTotals(input.items, variants, products);
  if (!priced.ok) {
    return { ok: false, error: priced.error as CheckoutError, message: priced.message };
  }
  const { lines, subtotalCents, shippingCents, totalCents } = priced;

  // Resolve the buyer's Stripe Customer BEFORE reserving, so the order row can
  // carry it from creation (INV-11 discriminator, never half-set).
  const customer = await ensureCustomer();
  if (!customer.ok) return { ok: false, error: "stripe_customer_failed" };

  // At most one open checkout session per user (Track G3): supersede the
  // caller's prior open attempts before reserving new stock. Never blocks —
  // control falls through to the new reservation regardless of the outcome.
  await supersedePriorOpenAttempts(db, session.user.id, expireSession);

  // Reserve stock atomically (INV-4). A failed guard fully reverses its own
  // partial decrement inside reserveStock, so no order row is written on
  // out_of_stock (Track C3/D2).
  const reserved = await reserveStock(db, lines);
  if (!reserved.ok) return reserved;

  const orderId = ulid();
  const num = orderNumber();
  const now = new Date();
  const s = input.shipping;
  const orderInsert = db.insert(customerOrder).values({
    id: orderId,
    orderNumber: num,
    userId: session.user.id,
    email: session.user.email ?? "",
    status: "pending",
    paymentStatus: "unpaid",
    // stripeCustomerId set in the SAME insert as the reservation write — INV-11.
    stripeCustomerId: customer.stripeCustomerId,
    shipName: s.name,
    shipLine1: s.line1,
    shipLine2: s.line2 ?? null,
    shipCity: s.city,
    shipRegion: s.region,
    shipPostal: s.postal,
    shipCountry: s.country ?? "CA",
    shipPhone: s.phone ?? null,
    subtotalCents,
    shippingCents,
    totalCents,
    createdAt: now,
    updatedAt: now,
  });
  const lineStatements = lines.map((line) =>
    db.insert(orderItem).values({
      id: ulid(),
      orderId,
      productId: line.productId,
      variantId: line.variantId,
      titleSnapshot: line.title,
      sizeSnapshot: line.size,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    }),
  );
  await db.batch([orderInsert, ...lineStatements] as never);

  // Create the Session. metadata.orderId links it before its id exists on our
  // side (Track C1/C2). On throw we reverse synchronously (Track C3).
  const returnUrl = `${cfg.STORE_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
  let created: CreatedCheckoutSession;
  try {
    created = await createStripeSession(
      buildSessionParams({
        customerId: customer.stripeCustomerId,
        lines,
        shippingCents,
        orderId,
        returnUrl,
      }),
      { idempotencyKey: `checkout:${orderId}` },
    );
  } catch (err) {
    await reverseReservation(db, orderId, lines);
    console.error(
      `[store] checkout.sessions.create failed for order ${orderId}: ${stripeErrorCode(err)}`,
    );
    return { ok: false, error: "stripe_session_failed" };
  }

  if (!created.client_secret) {
    // A session with no client secret can't drive the Element — reverse and
    // fail rather than hand back an unusable order.
    await reverseReservation(db, orderId, lines);
    return { ok: false, error: "stripe_session_failed" };
  }

  // INV-2: attach the matchable id (+ expiry for the reconciliation sweep)
  // BEFORE returning the client_secret the buyer can use to drive Stripe.
  await db
    .update(customerOrder)
    .set({
      stripeCheckoutSessionId: created.id,
      stripeSessionExpiresAt: created.expires_at ? new Date(created.expires_at * 1000) : null,
      updatedAt: new Date(),
    })
    .where(eq(customerOrder.id, orderId));

  return { ok: true, mode: "elements", clientSecret: created.client_secret, orderNumber: num };
}

export async function getOrderByStripeSessionCore(
  db: Db,
  session: PlatformSession,
  sessionId: string,
): Promise<OrderByStripeSessionResult> {
  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.stripeCheckoutSessionId, sessionId))
    .limit(1);
  // Unknown id OR another user's order → not_found (enumeration hardening).
  if (!order || order.userId !== session.user.id) return { ok: false, error: "not_found" };
  return {
    ok: true,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
  };
}
