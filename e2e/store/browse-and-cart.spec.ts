import { expect, test } from "@playwright/test";

/**
 * Store e2e — public browse → product detail → add to cart → cart.
 *
 * UNRUN DRAFT. Requires the local stack up and the store reachable; set
 * `STORE_E2E_URL` to the store's base (dev-direct, e.g.
 * `https://store.somewhatintelligent.localhost`, or a bouncer-fronted
 * `https://<host>/shop`). The suite skips when it's unset so it never fails a
 * bare `bun run test:e2e`. Seed a demo product first (`bun run seed`).
 *
 * Selectors are text/role-based (the ported components carry no data-testids
 * yet); tighten to data-testids when the store gets its interactive-test pass.
 */
const BASE = process.env.STORE_E2E_URL;
test.skip(!BASE, "set STORE_E2E_URL to run the store e2e suite");

test("browse the grid, open a product, add to cart, see it in the cart", async ({ page }) => {
  await page.goto(BASE!);

  // Grid → first product detail. The seed product is "Field Notes Tee".
  await page
    .getByRole("link", { name: /field notes tee/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/products\//);

  // Pick a size, add to cart.
  await page.getByRole("button", { name: "M" }).click();
  await page.getByRole("button", { name: /add to cart/i }).click();

  // Cart count badge increments; go to the cart.
  await page.getByRole("link", { name: /cart/i }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByText(/field notes tee/i)).toBeVisible();

  // In-app navigation kept the mount prefix (regression guard for the vmf +
  // client-basepath fix — only meaningful behind bouncer where BASE ends /shop).
  if (BASE!.includes("/shop")) {
    expect(new URL(page.url()).pathname).toBe("/shop/cart");
  }
});
