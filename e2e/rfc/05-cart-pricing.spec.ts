import { expect, test } from "@playwright/test";
import { SITE } from "./helpers";

/**
 * RFC-0001 browser test #7 — the browser cart holds only `{variantId, quantity}`
 * (INV-CART-1); display data is a separate, tamper-proof hint cache, and the
 * authoritative price always comes from Store.
 *
 * The full checkout journey (send the cart to Store, re-price, place the order)
 * requires the Bouncer-fronted same-origin `/api/store` mount + an authenticated
 * session, neither of which exists dev-direct (see 06-checkout-orders). What IS
 * fully exercisable locally is the price-authority invariant this item asserts:
 *  - adding a variant writes only `{variantId, quantity}` to the cart;
 *  - tampering the browser-local display hint (price) changes only the offline
 *    display, and the cart's authoritative refresh (Site-owned `/cart/lookup.json`,
 *    which reads StoreCatalog) overwrites it with the Store price.
 * So the price a checkout would use is Store's, never the browser's.
 */

const CART_KEY = "si:store:cart:v1";
const HINTS_KEY = "si:store:cart:hints:v1";

test("RFC#7 cart carries no price; the Store price wins over a tampered hint", async ({ page }) => {
  // Land on the seeded product and read the Store-authoritative price.
  await page.goto(`${SITE}/shop/field-notes-tee`, { waitUntil: "domcontentloaded" });
  const sheet = page.locator(".product-sheet[data-product-id]");
  const storePriceCents = Number(await sheet.getAttribute("data-price-cents"));
  expect(storePriceCents).toBeGreaterThan(0);

  // Add size M to the cart through the real UI.
  await page.locator('.product-size[data-size="M"]').click();
  await page.getByRole("button", { name: /add to cart/i }).click();
  await expect(page.locator("#add-feedback")).toHaveText(/added to cart/i);

  // The persisted cart holds ONLY variantId + quantity — never a price/title.
  const cart = JSON.parse(
    (await page.evaluate((k) => localStorage.getItem(k), CART_KEY)) ?? "null",
  );
  expect(cart.lines).toHaveLength(1);
  expect(Object.keys(cart.lines[0]).sort()).toEqual(["quantity", "variantId"]);
  expect(JSON.stringify(cart)).not.toContain(String(storePriceCents));

  // Tamper the browser-local DISPLAY hint: rewrite the price to a bogus $0.01.
  await page.evaluate(
    ({ key, bogus }) => {
      const hints = JSON.parse(localStorage.getItem(key) ?? "{}");
      for (const v of Object.keys(hints)) hints[v].priceCents = bogus;
      localStorage.setItem(key, JSON.stringify(hints));
    },
    { key: HINTS_KEY, bogus: 1 },
  );

  // On the cart page, the authoritative refresh (/cart/lookup.json → StoreCatalog)
  // overwrites the tampered hint. The rendered subtotal is the Store price, and
  // the tampered $0.01 never appears. (formatPrice drops whole-dollar cents:
  // 3800 → "$38 CAD".)
  const dollars =
    storePriceCents % 100 === 0
      ? String(storePriceCents / 100)
      : (storePriceCents / 100).toFixed(2);
  const priceRe = new RegExp(`\\$${dollars.replace(".", "\\.")}\\b`);
  await page.goto(`${SITE}/cart`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#cart-subtotal-value")).toHaveText(priceRe, { timeout: 15_000 });
  await expect(page.locator("#cart-lines")).toContainText(priceRe);
  await expect(page.locator(".cart-line-price")).not.toContainText("$0.01");

  // And the refresh rewrote the persisted hint back to the Store price.
  const restored = await page.evaluate((k) => {
    const hints = JSON.parse(localStorage.getItem(k) ?? "{}");
    return Object.values(hints).map((h) => (h as { priceCents: number }).priceCents);
  }, HINTS_KEY);
  expect(restored).toContain(storePriceCents);
});
