import { expect, test } from "@playwright/test";
import { OPERATOR, SITE, STORE } from "./helpers";

/**
 * RFC-0001 browser tests #8, #9, #10 — checkout, order status, and fulfilment.
 *
 * LOCAL BOUNDARY (asserted, not faked). The authenticated buyer journey cannot
 * complete in the dev-direct fleet, for structural reasons — not app defects:
 *  - Site (`:4321`) reaches the Store HTTP API same-origin as `/api/store/*`,
 *    a path that only exists behind Bouncer's passthrough mount. Bouncer is not
 *    in the local graph, so `/api/store/*` 404s on Site and the checkout island
 *    cannot create a session.
 *  - Store's checkout/order/session routes derive the buyer from the Bouncer
 *    Ed25519 envelope (self-stamped dev-direct from the Guestlist session
 *    cookie). That cookie is scoped to `.somewhatintelligent.localhost`; the
 *    Store host reachable in this fleet is `127.0.0.1:8793`, which shares no
 *    cookie with Identity, so no authenticated session reaches it.
 *  - #8's stub path additionally requires Stripe to be UNconfigured; the local
 *    Store is configured with Stripe TEST keys, so it takes the Stripe elements
 *    path (which needs iframe card entry + a `stripe listen` webhook forward).
 *
 * These specs assert every reachable boundary — Store's public config, the
 * 401 gate that proves the buyer is derived server-side (never client-supplied,
 * INV-9), the Site order-status page's client fetch + auth handling, and the
 * Operator Orders console rendering + fulfilment controls — and document what a
 * Bouncer-fronted session would add. `RFC_STORE_URL` may point at a
 * Bouncer-fronted, authenticated fleet to run the full journey.
 */

test("RFC#8 Store checkout config + the checkout gate derives the buyer server-side", async ({
  request,
}) => {
  // Public config carries only client-safe values (RFC D11): no secret, price id,
  // or customer id. Locally Stripe TEST keys are present → the Stripe (not stub)
  // path is active; the publishable key is a pk_test_ key.
  const configRes = await request.get(`${STORE}/api/store/config`);
  expect(configRes.status()).toBe(200);
  const config = await configRes.json();
  expect(config.currency).toBe("CAD");
  expect(config.stripeEnabled).toBe(true);
  expect(config.stripePublishableKey).toMatch(/^pk_test_/);
  expect(config).not.toHaveProperty("stripeSecretKey");

  // The checkout endpoint rejects an unauthenticated caller (401) BEFORE reading
  // the cart — the buyer is resolved from the session envelope, never from the
  // request body (INV-CART-1 / INV-9). This is the boundary an unauthenticated
  // context (no Bouncer/session) can reach; a real session would place the order.
  const checkoutRes = await request.post(`${STORE}/api/store/checkout-sessions`, {
    headers: { "content-type": "application/json" },
    data: {
      cart: { version: 1, lines: [{ variantId: "seed-var-ft-m", quantity: 1 }], updatedAt: 0 },
    },
    failOnStatusCode: false,
  });
  expect(checkoutRes.status()).toBe(401);
  expect((await checkoutRes.json()).error).toBe("unauthorized");
});

test("RFC#9 order-status page renders and authenticates its client fetch", async ({ page }) => {
  // The Site order-status page is a shell + client island that fetches the order
  // from `/api/store/orders/:n`. Dev-direct that path 404s on Site (no Bouncer
  // mount), so the island surfaces its load-failure state — proving the page
  // renders and its fetch path is wired. Behind Bouncer with an owning session,
  // the same island renders the paid order + status (the reachable local
  // assertion; the real order needs the authenticated journey).
  await page.goto(`${SITE}/orders/SI-DEMO-0001`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Order", level: 1 })).toBeVisible();
  await expect(page.getByText(/SI-DEMO-0001/i).first()).toBeVisible();
  await expect(page.locator("#order-error")).toBeVisible({ timeout: 15_000 });

  // The Store order endpoint itself gates on the owning session (401 → the buyer
  // is server-derived, never trusted from the client).
  const res = await page.request.get(`${STORE}/api/store/orders/SI-DEMO-0001`, {
    failOnStatusCode: false,
  });
  expect(res.status()).toBe(401);
});

test("RFC#10 Operator Orders console renders with fulfilment controls", async ({ page }) => {
  // Fulfilment is Operator-side (StoreOperator RPC, not the buyer HTTP API), so
  // the console renders dev-direct. Placing an order to fulfil needs the
  // authenticated buyer journey above; here we assert the Orders module — list,
  // status filters, empty/populated states — is wired end to end.
  await page.goto(`${OPERATOR}/orders`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();

  // The status filter chips are all present (the fulfilment lifecycle states).
  for (const status of ["all", "pending", "paid", "shipped", "delivered", "cancelled"]) {
    await expect(page.getByRole("button", { name: status, exact: true })).toBeVisible();
  }

  // Either the seeded/empty state renders, or (if an order exists) its row links
  // to the detail view where the fulfilment controls live. No order is placeable
  // locally, so assert the module resolved to one of its valid states.
  const emptyState = page.getByText(/no orders in this view/i);
  const table = page.locator("table");
  await expect(emptyState.or(table).first()).toBeVisible({ timeout: 15_000 });
});
