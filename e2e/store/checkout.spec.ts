import { expect, test } from "@playwright/test";

/**
 * Store e2e — authed checkout stub → order shows in /orders.
 *
 * UNRUN DRAFT. Requires the FULL local stack (bouncer + guestlist + identity +
 * store) so the identity sign-in round-trip works and the store's `/checkout`
 * + `/orders` authed routes resolve. Set `STORE_E2E_URL` (bouncer-fronted store
 * base, `https://<host>/shop`) and `STORE_E2E_EMAIL` / `STORE_E2E_PASSWORD` to a
 * seeded pre-verified user (e.g. alice@example.com / alicepwd123). Skips when
 * unset. Checkout is the manual stub — the order is placed `pending`, no card.
 */
const BASE = process.env.STORE_E2E_URL;
const EMAIL = process.env.STORE_E2E_EMAIL;
const PASSWORD = process.env.STORE_E2E_PASSWORD;
test.skip(!BASE || !EMAIL || !PASSWORD, "set STORE_E2E_URL + STORE_E2E_EMAIL/PASSWORD to run");

test("sign in, add to cart, place a pending order, see it in My orders", async ({ page }) => {
  // Add an item first (public), then hit checkout which bounces to identity.
  await page.goto(BASE!);
  await page
    .getByRole("link", { name: /field notes tee/i })
    .first()
    .click();
  await page.getByRole("button", { name: "M" }).click();
  await page.getByRole("button", { name: /add to cart/i }).click();
  await page.getByRole("link", { name: /cart/i }).click();
  await page.getByRole("link", { name: /checkout/i }).click();

  // Bounced to identity /account/sign-in — sign in (TanStack Form validates on
  // blur, so type + blur before submit; see the interactive-test skill).
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Back on the store checkout: fill shipping + place the order.
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByLabel(/name/i).fill("Ada Lovelace");
  await page
    .getByLabel(/address|line 1/i)
    .first()
    .fill("1 Analytical Way");
  await page.getByLabel(/city/i).fill("Toronto");
  await page.getByLabel(/region|province/i).fill("ON");
  await page.getByLabel(/postal/i).fill("M5V 2T6");
  await page.getByRole("button", { name: /place order/i }).click();

  // Lands on the order detail; status is the manual stub "Awaiting payment".
  await expect(page).toHaveURL(/\/orders\/SI-/);
  await expect(page.getByText(/awaiting payment/i)).toBeVisible();

  // And it appears in the customer's order list.
  await page.getByRole("link", { name: /my orders/i }).click();
  await expect(page.getByText(/SI-/)).toBeVisible();
});
