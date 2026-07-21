// The public Store HTTP API (RFC-0001 D11 / T12), consumed by Site's Astro
// cart/checkout islands through bouncer's `/api/store` passthrough mount, plus
// the Stripe webhook ingress (`/hooks/store/stripe`). Kept in its own module so
// `StoreApiType` stays a shallow, DTO-shaped surface Site consumes via
// `hono/client` — never leaking Drizzle/internal query shapes.
//
// Buyer resolution is the bouncer Ed25519 envelope + guestlist RPC, read through
// the platform `getSession` (injected via `deps.resolveSession` so the pool
// suite can drive the D1 write path with a fixed session). The heavy request
// paths — the embedded Stripe checkout, the release re-pricing, the media read
// port — delegate to the SAME cores the TanStack Start server fns use
// (`lib/checkout`, `lib/pricing`, `lib/reservation`, `lib/catalog`), so no
// invariant is re-implemented here.
import { Hono } from "hono";
import { cors } from "hono/cors";
import { type } from "arktype";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { platformDeployConfig } from "@si/config";
import { stripeConfigured } from "@somewhatintelligent/stripe";
import { ulid } from "@somewhatintelligent/kit/ids";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { cartV1Schema, normalizeCart } from "@si/contracts/cart";
import type {
  CheckoutErrorResponse,
  CheckoutSessionStatusResponse,
  CreateCheckoutSessionResponse,
  OrderDetailDTO,
  StorePublicConfig,
} from "@si/contracts";

import * as schema from "@/db/schema";
import { customerOrder, orderItem } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { CustomerOrder, OrderItem } from "@/db/schema";
import type { OrderStatus } from "@/lib/config";
import { orderNumber as newOrderNumber } from "@/lib/config";
import { makeStripeClient } from "@/lib/stripe-client";
import {
  createCheckoutSessionCore,
  getOrderByStripeSessionCore,
  type DahliaSessionCreateParams,
  type EnsureCustomerResult,
  type SessionExpirer,
  type ShippingRateLister,
  type StripeSessionCreator,
} from "@/lib/checkout";
import { computeOrderTotals, loadPricingInputs, type OrderTotals } from "@/lib/pricing";
import { reserveStockAndWrite } from "@/lib/reservation";
import { updateOrderShippingCore } from "@/lib/orders-core";
import { openProductMedia } from "@/lib/catalog";
import type { MediaStorage } from "@/lib/media-storage";
import { handleStoreStripeWebhook } from "@/lib/stripe-webhook";

// The one Stripe seam createCheckoutSessionCore needs — the session creator, the
// supersede expirer, and the Dashboard rate lister. The pool suite injects
// stubs; production builds a real client past the stripeConfigured gate.
interface StripeCheckoutDeps {
  createStripeSession: StripeSessionCreator;
  expireSession: SessionExpirer;
  listShippingRates: ShippingRateLister;
}

// The injectable boundary. Every dependency the routes reach across (session,
// customer resolution, Stripe, media read port) is behind this so the HTTP
// layer is drivable against a real D1 with everything else stubbed — mirroring
// how checkout.functions.ts injects the same seams into the checkout core.
export interface StoreApiDeps {
  resolveSession(headers: Headers): Promise<PlatformSession | null>;
  ensureStripeCustomer(cookie: string, env: Env): Promise<EnsureCustomerResult>;
  stripeDeps(secretKey: string): StripeCheckoutDeps;
  mediaStorage(env: Env): Promise<MediaStorage>;
}

// One client per request, lazily built and shared between the session creator
// and the expirer (mirrors checkout.functions.ts's makeStripeDeps). Never
// invoked until createCheckoutSessionCore calls past the stripeConfigured gate.
function makeStripeCheckoutDeps(secretKey: string): StripeCheckoutDeps {
  let client: Stripe | undefined;
  const stripe = () => (client ??= makeStripeClient(secretKey));
  return {
    createStripeSession: (params: DahliaSessionCreateParams, options) =>
      stripe().checkout.sessions.create(
        params as unknown as Stripe.Checkout.SessionCreateParams,
        options,
      ),
    expireSession: async (sessionId: string) => {
      await stripe().checkout.sessions.expire(sessionId);
    },
    listShippingRates: async () => {
      const { data } = await stripe().shippingRates.list({ active: true, limit: 100 });
      return data.flatMap((r) =>
        r.type === "fixed_amount" && r.fixed_amount?.currency === "cad"
          ? [
              {
                id: r.id,
                amountCents: r.fixed_amount.amount,
                minSubtotalCents: Number.parseInt(r.metadata?.min_subtotal_cents ?? "0", 10) || 0,
              },
            ]
          : [],
      );
    },
  };
}

// Production wiring. `resolveSession`/`mediaStorage` are dynamic-imported so this
// module loads without pulling the platform singleton or the Roadie SDK into
// non-request graphs (and so the injected-deps pool suite never touches them).
const defaultDeps: StoreApiDeps = {
  resolveSession: async (headers) => (await import("@/lib/platform")).getSession(headers),
  ensureStripeCustomer: async (cookie, env) => {
    // Forward the inbound session cookie as the sole credential (never a
    // client-supplied user id — INV-9); guestlist derives the actor and
    // get-or-creates the Stripe Customer.
    const res = await env.GUESTLIST.ensureStripeCustomer({ cookie });
    return res.ok ? { ok: true, stripeCustomerId: res.stripeCustomerId } : { ok: false };
  },
  stripeDeps: makeStripeCheckoutDeps,
  mediaStorage: async () => {
    const [{ createRoadieMediaStorage, STORE_MEDIA_APPLICATION }, { getRoadie }] =
      await Promise.all([import("@/lib/media-storage-roadie"), import("@/lib/roadie")]);
    return createRoadieMediaStorage(
      getRoadie() as unknown as Parameters<typeof createRoadieMediaStorage>[0],
      { application: STORE_MEDIA_APPLICATION },
    );
  },
};

function database(env: Env): Db {
  return drizzle(env.DB, { schema });
}

// The checkout request body — the public cart contract only (INV-CART-1): a
// `{version, lines:{variantId,quantity}[], updatedAt}` cart, never a price.
const checkoutBody = type({ cart: cartV1Schema });

// Canada-only buyer shipping address (contracts ShippingAddress); country stays
// optional here and defaults to "CA" in updateOrderShippingCore.
const shippingBody = type({
  name: "2 <= string <= 120",
  line1: "1 <= string <= 160",
  "line2?": "string <= 160",
  city: "1 <= string <= 80",
  region: "1 <= string <= 80",
  postal: "1 <= string <= 20",
  "country?": "'CA'",
  "phone?": "string <= 40",
});

// Map the checkout core's error vocabulary onto the frozen contract error union
// (the core's `variant_not_found` is the contract's `variant_unavailable`).
const CORE_TO_CONTRACT: Record<string, CheckoutErrorResponse["error"]> = {
  empty_cart: "empty_cart",
  variant_not_found: "variant_unavailable",
  product_unavailable: "product_unavailable",
  out_of_stock: "out_of_stock",
  stripe_customer_failed: "stripe_customer_failed",
  stripe_session_failed: "stripe_session_failed",
};

// Validation-class errors are 400; domain-class errors are 409 (RFC D11).
function statusForCheckoutError(error: CheckoutErrorResponse["error"]): 400 | 409 {
  return error === "invalid_cart" || error === "empty_cart" ? 400 : 409;
}

// Collapse the order's lifecycle onto the three states the checkout return
// island polls: a cancelled/expired order reads `failed`, a settled one `paid`,
// everything else still `pending`.
function checkoutState(
  status: OrderStatus,
  paymentStatus: string,
): CheckoutSessionStatusResponse["state"] {
  if (status === "cancelled" || paymentStatus === "expired" || paymentStatus === "failed") {
    return "failed";
  }
  if (
    status === "paid" ||
    status === "shipped" ||
    status === "delivered" ||
    paymentStatus === "paid"
  ) {
    return "paid";
  }
  return "pending";
}

// Assemble the buyer-facing OrderDetailDTO from the order row + its line items.
// Shape mirrors the contract exactly (timestamps → epoch ms, null-safe address).
function toOrderDetail(order: CustomerOrder, items: OrderItem[]): OrderDetailDTO {
  const shipping: OrderDetailDTO["shipping"] =
    order.shipName === null ||
    order.shipLine1 === null ||
    order.shipCity === null ||
    order.shipRegion === null ||
    order.shipPostal === null
      ? null
      : {
          name: order.shipName,
          line1: order.shipLine1,
          ...(order.shipLine2 !== null ? { line2: order.shipLine2 } : {}),
          city: order.shipCity,
          region: order.shipRegion,
          postal: order.shipPostal,
          country: "CA",
          ...(order.shipPhone !== null ? { phone: order.shipPhone } : {}),
        };
  return {
    orderNumber: order.orderNumber,
    customerId: order.userId,
    email: order.email,
    status: order.status,
    paymentStatus: order.paymentStatus,
    subtotalCents: order.subtotalCents,
    shippingCents: order.shippingCents,
    totalCents: order.totalCents,
    shipping,
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

// Manual-stub order placement for the keyless (Stripe-unconfigured) path:
// reserve stock + write the order with a NULL shipping address (the buyer adds
// it later via PATCH /shipping), reusing the same reservation core the Stripe
// path does. INV-CART-1 holds — `priced` came from the D1 release, not the cart.
async function placeStubOrder(
  db: Db,
  session: PlatformSession,
  priced: Extract<OrderTotals, { ok: true }>,
): Promise<{ ok: true; orderNumber: string } | { ok: false; error: "out_of_stock" }> {
  const id = ulid();
  const num = newOrderNumber();
  const now = new Date();
  const orderInsert = db.insert(customerOrder).values({
    id,
    orderNumber: num,
    userId: session.user.id,
    email: session.user.email ?? "",
    status: "pending",
    paymentStatus: "unpaid",
    shipName: null,
    shipLine1: null,
    shipLine2: null,
    shipCity: null,
    shipRegion: null,
    shipPostal: null,
    shipCountry: "CA",
    shipPhone: null,
    subtotalCents: priced.subtotalCents,
    shippingCents: priced.shippingCents,
    totalCents: priced.totalCents,
    createdAt: now,
    updatedAt: now,
  });
  const lineStatements = priced.lines.map((line) =>
    db.insert(orderItem).values({
      id: ulid(),
      orderId: id,
      productId: line.productId,
      variantId: line.variantId,
      titleSnapshot: line.title,
      sizeSnapshot: line.size,
      unitPriceCents: line.unitPriceCents,
      quantity: line.quantity,
    }),
  );
  const reserved = await reserveStockAndWrite(db, priced.lines, {
    orderId: id,
    statements: [orderInsert, ...lineStatements],
  });
  if (!reserved.ok) return { ok: false, error: "out_of_stock" };
  return { ok: true, orderNumber: num };
}

// Credentialed CORS allowlist for the browser store API: the apex + every
// subdomain of both deploy domains, echoing the exact origin (never `*`, which
// credentialed fetch forbids). Deployed calls arrive same-origin through bouncer
// so these headers go unused there; local dev's cross-origin Site→Store call
// (site.* → store.*, both under devDomain) is what this covers — with no literal.
const CORS_DOMAINS = [platformDeployConfig.baseDomain, platformDeployConfig.devDomain];
const originAllowed = (origin: string) =>
  CORS_DOMAINS.some((d) =>
    new RegExp(`^https?://([a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}$`).test(origin),
  );

/**
 * Build the Store HTTP API. `deps` defaults to production wiring; the pool suite
 * passes stubbed session/customer/Stripe/media seams. Routes are chained so
 * `StoreApiType` carries the full typed surface for `hono/client`.
 */
export function createStoreApi(deps: StoreApiDeps = defaultDeps) {
  return (
    new Hono<{ Bindings: Env }>()
      // Buyer HTTP API CORS: exact-origin echo + credentials for the session
      // cookie. `/hooks/store/*` (Stripe webhook, server-to-server) is left
      // uncovered by scoping the middleware to `/api/store/*`.
      .use(
        "/api/store/*",
        cors({
          origin: (origin) => (origin && originAllowed(origin) ? origin : null),
          credentials: true,
          allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
          allowHeaders: ["content-type", "accept"],
        }),
      )
      // Public config — no Stripe secret, webhook secret, price id, or customer
      // id ever crosses the wire (RFC D11); only the client-safe publishable key.
      .get("/api/store/config", (c) => {
        const stripeEnabled =
          stripeConfigured(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SIGNING_SECRET) &&
          Boolean(c.env.STRIPE_PUBLISHABLE_KEY);
        return c.json<StorePublicConfig>({
          currency: "CAD",
          stripeEnabled,
          stripePublishableKey: c.env.STRIPE_PUBLISHABLE_KEY || null,
          maxQuantityPerLine: 10,
        });
      })

      // Create a checkout session. Store re-prices from the active release,
      // reserves stock, writes the order, and (Stripe configured) creates the
      // embedded Payment Element session — all in createCheckoutSessionCore.
      .post("/api/store/checkout-sessions", async (c) => {
        const session = await deps.resolveSession(c.req.raw.headers);
        if (!session) return c.json({ ok: false as const, error: "unauthorized" as const }, 401);

        const raw = await c.req.json().catch(() => null);
        const parsed = checkoutBody(raw);
        if (parsed instanceof type.errors) {
          return c.json<CheckoutErrorResponse>({ ok: false, error: "invalid_cart" }, 400);
        }
        // Defensively dedupe/clamp/cap the cart, then derive the item lines.
        const cart = normalizeCart(parsed.cart, Date.now());
        const items = cart.lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
        if (items.length === 0) {
          return c.json<CheckoutErrorResponse>({ ok: false, error: "empty_cart" }, 400);
        }

        const db = database(c.env);
        const fail = (coreError: string) => {
          const error = CORE_TO_CONTRACT[coreError] ?? "stripe_session_failed";
          return c.json<CheckoutErrorResponse>({ ok: false, error }, statusForCheckoutError(error));
        };

        // Keyless: place a manual-stub order (no gateway), shipping added later.
        if (!stripeConfigured(c.env.STRIPE_SECRET_KEY, c.env.STRIPE_WEBHOOK_SIGNING_SECRET)) {
          const { variants, products } = await loadPricingInputs(
            db,
            items.map((i) => i.variantId),
          );
          const priced = computeOrderTotals(items, variants, products);
          if (!priced.ok) return fail(priced.error);
          const placed = await placeStubOrder(db, session, priced);
          if (!placed.ok) return fail(placed.error);
          return c.json<CreateCheckoutSessionResponse>({
            ok: true,
            mode: "stub",
            orderNumber: placed.orderNumber,
          });
        }

        const stripe = deps.stripeDeps(c.env.STRIPE_SECRET_KEY);
        const result = await createCheckoutSessionCore({
          db,
          session,
          input: { items },
          // return_url is baked from SITE_URL: the `/checkout/return` page renders
          // on Site, not the (headless) Store worker. STORE_URL stays apex-pinned
          // for envelope host comparison — this override is local to the core.
          env: {
            STRIPE_SECRET_KEY: c.env.STRIPE_SECRET_KEY,
            STRIPE_WEBHOOK_SIGNING_SECRET: c.env.STRIPE_WEBHOOK_SIGNING_SECRET,
            STORE_URL: c.env.SITE_URL,
          },
          ensureCustomer: () =>
            deps.ensureStripeCustomer(c.req.raw.headers.get("cookie") ?? "", c.env),
          createStripeSession: stripe.createStripeSession,
          expireSession: stripe.expireSession,
          listShippingRates: stripe.listShippingRates,
        });

        if (!result.ok) return fail(result.error);
        if (result.mode !== "elements") return fail("stripe_session_failed");
        return c.json<CreateCheckoutSessionResponse>({
          ok: true,
          mode: "stripe",
          orderNumber: result.orderNumber,
          clientSecret: result.clientSecret,
          returnUrl: `${c.env.SITE_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
        });
      })

      // Session status for the owning customer only — a foreign or unknown
      // session id is indistinguishable from not-found (enumeration hardening).
      .get("/api/store/checkout-sessions/:sessionId", async (c) => {
        const session = await deps.resolveSession(c.req.raw.headers);
        if (!session) return c.json({ ok: false as const, error: "unauthorized" as const }, 401);
        const res = await getOrderByStripeSessionCore(
          database(c.env),
          session,
          c.req.param("sessionId"),
        );
        if (!res.ok) return c.json({ ok: false as const, error: "not_found" as const }, 404);
        return c.json<CheckoutSessionStatusResponse>({
          ok: true,
          state: checkoutState(res.status, res.paymentStatus),
          orderNumber: res.orderNumber,
        });
      })

      // Order detail for the owning customer only (operator access uses RPC).
      .get("/api/store/orders/:orderNumber", async (c) => {
        const session = await deps.resolveSession(c.req.raw.headers);
        if (!session) return c.json({ ok: false as const, error: "unauthorized" as const }, 401);
        const db = database(c.env);
        const [order] = await db
          .select()
          .from(customerOrder)
          .where(eq(customerOrder.orderNumber, c.req.param("orderNumber")))
          .limit(1);
        // Unknown OR another customer's order → 404 (never confirm existence).
        if (!order || order.userId !== session.user.id) {
          return c.json({ ok: false as const, error: "not_found" as const }, 404);
        }
        const items = await db.select().from(orderItem).where(eq(orderItem.orderId, order.id));
        return c.json<OrderDetailDTO>(toOrderDetail(order, items));
      })

      // Edit an order's shipping address — owning customer, before it ships.
      .patch("/api/store/orders/:orderNumber/shipping", async (c) => {
        const session = await deps.resolveSession(c.req.raw.headers);
        if (!session) return c.json({ ok: false as const, error: "unauthorized" as const }, 401);
        const raw = await c.req.json().catch(() => null);
        const parsed = shippingBody(raw);
        if (parsed instanceof type.errors) {
          return c.json({ ok: false as const, error: "invalid_shipping" as const }, 400);
        }
        try {
          const res = await updateOrderShippingCore(
            database(c.env),
            session,
            c.req.param("orderNumber"),
            parsed,
          );
          if (!res.ok) return c.json({ ok: false as const, error: "not_editable" as const }, 409);
          return c.json({ ok: true as const });
        } catch {
          // Missing order or a non-owner both surface as not-found for the buyer.
          return c.json({ ok: false as const, error: "not_found" as const }, 404);
        }
      })

      // Streamed product media, eligible only when the id is in an active
      // product's active release (INV-MEDIA-1) — all else is 404.
      .get("/api/store/media/:mediaId", async (c) => {
        const res = await openProductMedia(
          database(c.env),
          await deps.mediaStorage(c.env),
          c.req.param("mediaId"),
        );
        if (!res.ok) return c.body(null, 404);
        return res.value;
      })

      // Stripe webhook ingress (renamed from /hooks/store). Verifies + enqueues;
      // holds no session.
      .post("/hooks/store/stripe", (c) => handleStoreStripeWebhook(c.req.raw, c.env))
  );
}

export const storeApi = createStoreApi();
export type StoreApiType = typeof storeApi;
export default storeApi;
