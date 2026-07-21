// Request-path core of the embedded Payment Element checkout, extracted from
// the server-fn wrapper (checkout.functions.ts) so the D1 write path is
// unit/pool-testable without the TanStack server-fn runtime — same split as
// pricing.ts / reservation.ts. The Stripe API call and Stripe-Customer
// resolution are injected (StripeSessionCreator / EnsureCustomer) so the pool
// tier drives this against a real D1 with both mocked. Stripe appears only as a
// type here (`import type`) — the client is constructed in the wrapper.
import type Stripe from "stripe";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { customerOrder, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db";
import { ulid } from "@somewhatintelligent/kit/ids";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { computeOrderTotals, loadPricingInputs, type OrderLine } from "@/lib/pricing";
import { reserveStockAndWrite } from "@/lib/reservation";
import { releaseAndCancel, type SessionExpirer } from "@/lib/reconcile";
import { orderNumber, type OrderStatus } from "@/lib/config";
import { stripeConfigured } from "@somewhatintelligent/stripe";

// Stripe rejects expires_at under its 30-minute minimum; the extra 5 minutes
// absorb clock skew/latency while still bounding the reservation window
// (Track A4/D4).
const CHECKOUT_SESSION_TTL_SECONDS = 35 * 60;

// The cart shape createCheckoutSession accepts — items only. The shipping
// address is collected by Stripe's ShippingAddressElement during payment and
// backfilled onto the order by the completed webhook.
export interface CheckoutInput {
  items: { variantId: string; quantity: number }[];
}

// A Dashboard-managed shipping rate (`shr_…`), listed at session-create time.
// `minSubtotalCents` comes from the rate's `min_subtotal_cents` metadata
// (absent → 0), so thresholds like free-over-$150 are Dashboard-editable.
export interface ShippingRateOption {
  id: string;
  amountCents: number;
  minSubtotalCents: number;
}
export type ShippingRateLister = () => Promise<ShippingRateOption[]>;

// Stripe's shipping_options accepts at most this many entries.
const MAX_SHIPPING_OPTIONS = 5;

// The rates a subtotal qualifies for, cheapest-first, capped at Stripe's
// shipping_options limit. The first (cheapest) entry is Stripe's default
// selection and the order's provisional shippingCents; an empty result means no
// rate is configured for this subtotal (the session falls back to the built-in
// flat rate).
export function applicableShippingRates(
  rates: readonly ShippingRateOption[],
  subtotalCents: number,
): ShippingRateOption[] {
  return rates
    .filter((r) => r.minSubtotalCents <= subtotalCents)
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, MAX_SHIPPING_OPTIONS);
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

export type { SessionExpirer } from "@/lib/reconcile";

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
  listShippingRates: ShippingRateLister;
}

function buildSessionParams(opts: {
  customerId: string;
  lines: readonly OrderLine[];
  shippingRates: readonly ShippingRateOption[];
  fallbackShippingCents: number;
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
    // Stripe collects and validates the shipping address (ShippingAddressElement
    // at payment); the completed webhook backfills it onto the order.
    shipping_address_collection: { allowed_countries: ["CA"] },
    // Shipping rides shipping_options: the Dashboard-managed rates the subtotal
    // qualifies for (cheapest-first, capped), else the built-in flat rate (Track
    // B3).
    shipping_options:
      opts.shippingRates.length > 0
        ? opts.shippingRates.map((r) => ({ shipping_rate: r.id }))
        : [
            {
              shipping_rate_data: {
                display_name: "Shipping",
                type: "fixed_amount",
                fixed_amount: { amount: opts.fallbackShippingCents, currency: "cad" },
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
    await db.batch(releaseAndCancel(db, prior.id, new Date()));
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

  // Re-price from the authoritative active-release + live-variant rows
  // (INV-CART-1/INV-CHK-1): title + price come from each product's active
  // product_release, size + stock from the live product_variant. A cart line
  // carries only variantId + quantity, so a stale/forged snapshot can set
  // neither the price nor the title.
  const variantIds = input.items.map((i) => i.variantId);
  const { variants, products } = await loadPricingInputs(db, variantIds);
  const priced = computeOrderTotals(input.items, variants, products);
  if (!priced.ok) {
    return { ok: false, error: priced.error as CheckoutError, message: priced.message };
  }
  const { lines, subtotalCents } = priced;

  // The Dashboard-managed rates the subtotal qualifies for (metadata-
  // thresholded), else the built-in flat rate. A listing failure degrades to the
  // fallback, never blocks checkout. Totals here are PROVISIONAL — the default
  // (cheapest) rate — and the completed webhook finalizes them from the buyer's
  // actual Stripe selection.
  let shippingRates: ShippingRateOption[] = [];
  try {
    shippingRates = applicableShippingRates(await deps.listShippingRates(), subtotalCents);
  } catch (err) {
    console.warn(
      `[store] shippingRates.list failed, using built-in rate: ${err instanceof Error ? err.message : "unknown"}`,
    );
  }
  const shippingCents = shippingRates[0]?.amountCents ?? priced.shippingCents;
  const totalCents = subtotalCents + shippingCents;

  // Resolve the buyer's Stripe Customer BEFORE reserving, so the order row can
  // carry it from creation (INV-11 discriminator, never half-set).
  const customer = await ensureCustomer();
  if (!customer.ok) return { ok: false, error: "stripe_customer_failed" };

  // At most one open checkout session per user (Track G3): supersede the
  // caller's prior open attempts before reserving new stock. Never blocks —
  // control falls through to the new reservation regardless of the outcome.
  await supersedePriorOpenAttempts(db, session.user.id, expireSession);

  const orderId = ulid();
  const num = orderNumber();
  const now = new Date();
  // Shipping address is NULL until the completed webhook backfills the Stripe-
  // collected address; fulfillment only reads it once the order is paid.
  const orderInsert = db.insert(customerOrder).values({
    id: orderId,
    orderNumber: num,
    userId: session.user.id,
    email: session.user.email ?? "",
    status: "pending",
    paymentStatus: "unpaid",
    // stripeCustomerId set in the SAME insert as the reservation write — INV-11.
    stripeCustomerId: customer.stripeCustomerId,
    shipName: null,
    shipLine1: null,
    shipLine2: null,
    shipCity: null,
    shipRegion: null,
    shipPostal: null,
    shipCountry: "CA",
    shipPhone: null,
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

  // Guards + order rows in one transaction (INV-4, Track C3/D2).
  const reserved = await reserveStockAndWrite(db, lines, {
    orderId,
    statements: [orderInsert, ...lineStatements],
  });
  if (!reserved.ok) return reserved;

  // Create the Session. metadata.orderId links it before its id exists on our
  // side (Track C1/C2). On throw we reverse synchronously (Track C3).
  const returnUrl = `${cfg.STORE_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`;
  let created: CreatedCheckoutSession;
  try {
    created = await createStripeSession(
      buildSessionParams({
        customerId: customer.stripeCustomerId,
        lines,
        shippingRates,
        fallbackShippingCents: shippingCents,
        orderId,
        returnUrl,
      }),
      { idempotencyKey: `checkout:${orderId}` },
    );
  } catch (err) {
    await db.batch(releaseAndCancel(db, orderId, new Date()));
    console.error(
      `[store] checkout.sessions.create failed for order ${orderId}: ${stripeErrorCode(err)}`,
    );
    return { ok: false, error: "stripe_session_failed" };
  }

  if (!created.client_secret) {
    // Unusable session: attach its id so later webhooks can match the order,
    // best-effort expire it at Stripe, then reverse.
    await db
      .update(customerOrder)
      .set({
        stripeCheckoutSessionId: created.id,
        stripeSessionExpiresAt: created.expires_at ? new Date(created.expires_at * 1000) : null,
        updatedAt: new Date(),
      })
      .where(eq(customerOrder.id, orderId));
    try {
      await expireSession(created.id);
    } catch {
      // Not open at Stripe; a webhook settles it.
    }
    await db.batch(releaseAndCancel(db, orderId, new Date()));
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
