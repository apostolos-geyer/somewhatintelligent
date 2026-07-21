/**
 * D1 integration (real local D1 via miniflare): the public `/api/store` HTTP
 * API (RFC-0001 D11 / T12). The pool harness binds ONLY D1 — no guestlist RPC,
 * no Stripe, no Roadie — so the Hono app is built with its session / customer /
 * Stripe / media seams injected, exercising the real routing + core write path
 * against a REAL D1. Proves the load-bearing HTTP-boundary invariants: config
 * leaks no secret, auth is required, INV-CART-1 survives the HTTP layer (a
 * forged cart price never reaches the order), cross-customer session/order
 * lookups collapse to not-found, ineligible media 404s, and the webhook path
 * migrated to /hooks/store/stripe. Mirrors checkout-session.itest.ts.
 */
import { env as cfEnv } from "cloudflare:test";
import type { PlatformSession } from "@somewhatintelligent/auth";
import * as schema from "@/db/schema";
import { createStoreApi, type StoreApiDeps } from "@/api/store-api";
import { STORE_STRIPE_WEBHOOK_PATH } from "@/lib/stripe-webhook";
import { db, seedOrder, seedOrderItem, seedProduct, seedVariant } from "./helpers";

const { productBase, productVariant, customerOrder, orderItem } = schema;

// Stripe "configured" test env — the checkout core takes the Stripe path (its
// session creator is stubbed below), never the keyless stub branch. `DB` is the
// same miniflare binding the helpers' `db` wraps, so the handler's own drizzle
// client sees rows seeded through `db`.
const testEnv = {
  DB: cfEnv.DB,
  STRIPE_SECRET_KEY: "sk_test_x",
  STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x",
  STRIPE_PUBLISHABLE_KEY: "pk_test_x",
  SITE_URL: "https://site.somewhatintelligent.localhost",
} as unknown as Env;

const session = (id = "buyer-1"): PlatformSession =>
  ({ user: { id, email: `${id}@example.com`, role: "user" } }) as unknown as PlatformSession;

const noMedia: StoreApiDeps["mediaStorage"] = async () => ({
  put: async () => ({ ok: false, error: "unavailable" }),
  read: async () => ({ ok: false, error: "not_found" }),
  delete: async () => ({ ok: false, error: "unavailable" }),
});

// Build the app with every non-D1 seam stubbed. Overrides let a test flip the
// resolved session (or make it anonymous) without touching the others.
function makeApp(over: Partial<StoreApiDeps> = {}) {
  return createStoreApi({
    resolveSession: async () => session(),
    ensureStripeCustomer: async () => ({ ok: true, stripeCustomerId: "cus_test" }),
    stripeDeps: () => ({
      createStripeSession: async () => ({
        id: "cs_test",
        client_secret: "cs_test_secret",
        expires_at: Math.floor(Date.now() / 1000) + 1800,
      }),
      expireSession: async () => {},
      listShippingRates: async () => [],
    }),
    mediaStorage: noMedia,
    ...over,
  });
}

function req(path: string, init?: RequestInit) {
  return new Request(`https://store.somewhatintelligent.localhost${path}`, init);
}

function postJson(path: string, body: unknown) {
  return req(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await db.delete(orderItem);
  await db.delete(customerOrder);
  await db.delete(productVariant);
  await db.delete(productBase);
});

describe("GET /api/store/config", () => {
  it("returns the public config and never leaks a secret", async () => {
    const app = makeApp();
    const res = await app.fetch(req("/api/store/config"), testEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      currency: "CAD",
      stripeEnabled: true,
      stripePublishableKey: "pk_test_x",
      maxQuantityPerLine: 10,
    });
    // Neither the secret key nor the webhook secret appears anywhere.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("sk_test_x");
    expect(raw).not.toContain("whsec_x");
  });
});

describe("POST /api/store/checkout-sessions", () => {
  it("401s when unauthenticated", async () => {
    const app = makeApp({ resolveSession: async () => null });
    const res = await app.fetch(
      postJson("/api/store/checkout-sessions", {
        cart: { version: 1, lines: [{ variantId: "v1", quantity: 1 }], updatedAt: Date.now() },
      }),
      testEnv,
    );
    expect(res.status).toBe(401);
  });

  it("400 invalid_cart for a malformed body", async () => {
    const app = makeApp();
    const res = await app.fetch(
      postJson("/api/store/checkout-sessions", { cart: { nope: 1 } }),
      testEnv,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "invalid_cart" });
  });

  it("ignores a forged cart price — the order prices from the D1 release (INV-CART-1)", async () => {
    await seedProduct({ id: "p1", title: "Field Tee", priceCents: 2500 });
    await seedVariant({ id: "v1", productId: "p1", size: "M", stock: 5 });

    // The cart line smuggles a price + title; the HTTP layer strips them and the
    // core re-prices by variantId from the active release.
    const app = makeApp();
    const res = await app.fetch(
      postJson("/api/store/checkout-sessions", {
        cart: {
          version: 1,
          lines: [
            { variantId: "v1", quantity: 1, unitPriceCents: 1, priceCents: 1, title: "FREE" },
          ],
          updatedAt: Date.now(),
        },
      }),
      testEnv,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      mode: "stripe",
      clientSecret: "cs_test_secret",
      returnUrl: `${testEnv.SITE_URL}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });

    // The persisted order carries the D1 price (2500), never the forged 1.
    const [order] = await db.select().from(customerOrder);
    expect(order!.subtotalCents).toBe(2500);
  });
});

describe("GET /api/store/checkout-sessions/:sessionId", () => {
  it("404s for another customer's session (indistinguishable from missing)", async () => {
    await seedOrder({ id: "o1", userId: "buyer-1", stripeCheckoutSessionId: "cs_owner" });
    const app = makeApp({ resolveSession: async () => session("stranger") });
    const res = await app.fetch(req("/api/store/checkout-sessions/cs_owner"), testEnv);
    expect(res.status).toBe(404);
  });

  it("returns the owning customer's session state", async () => {
    await seedOrder({
      id: "o1",
      orderNumber: "SI-OWN",
      userId: "buyer-1",
      stripeCheckoutSessionId: "cs_owner",
    });
    const app = makeApp({ resolveSession: async () => session("buyer-1") });
    const res = await app.fetch(req("/api/store/checkout-sessions/cs_owner"), testEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, state: "pending", orderNumber: "SI-OWN" });
  });
});

describe("GET /api/store/orders/:orderNumber", () => {
  async function seedOwned() {
    await seedOrder({ id: "o1", orderNumber: "SI-OWN", userId: "buyer-1", subtotalCents: 3000 });
    await seedOrderItem({
      id: "oi1",
      orderId: "o1",
      productId: "p1",
      variantId: "v1",
      titleSnapshot: "Field Tee",
      sizeSnapshot: "M",
      unitPriceCents: 3000,
      quantity: 1,
    });
  }

  it("returns OrderDetailDTO to the owning customer", async () => {
    await seedOwned();
    const app = makeApp({ resolveSession: async () => session("buyer-1") });
    const res = await app.fetch(req("/api/store/orders/SI-OWN"), testEnv);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      orderNumber: "SI-OWN",
      customerId: "buyer-1",
      items: [{ productId: "p1", variantId: "v1", title: "Field Tee", size: "M", quantity: 1 }],
    });
  });

  it("404s for a non-owner (never confirms existence)", async () => {
    await seedOwned();
    const app = makeApp({ resolveSession: async () => session("stranger") });
    const res = await app.fetch(req("/api/store/orders/SI-OWN"), testEnv);
    expect(res.status).toBe(404);
  });

  it("401s when unauthenticated", async () => {
    const app = makeApp({ resolveSession: async () => null });
    const res = await app.fetch(req("/api/store/orders/SI-OWN"), testEnv);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/store/media/:mediaId", () => {
  it("404s for an unknown / ineligible media id", async () => {
    const app = makeApp();
    const res = await app.fetch(req("/api/store/media/does-not-exist"), testEnv);
    expect(res.status).toBe(404);
  });
});

describe("webhook path migration (/hooks/store → /hooks/store/stripe)", () => {
  it("the store constant is namespaced", () => {
    expect(STORE_STRIPE_WEBHOOK_PATH).toBe("/hooks/store/stripe");
  });

  it("routes the migrated webhook path (matched, not 404)", async () => {
    const app = makeApp();
    const res = await app.fetch(postJson("/hooks/store/stripe", {}), testEnv);
    // Stripe is "configured" but the request is unsigned → the webhook handler
    // rejects it (400 missing_signature). The point: the route MATCHED, not 404.
    expect(res.status).not.toBe(404);
    expect(res.status).toBe(400);
  });

  it("the old /hooks/store path no longer intercepts (404)", async () => {
    const app = makeApp();
    const res = await app.fetch(postJson("/hooks/store", {}), testEnv);
    expect(res.status).toBe(404);
  });
});
