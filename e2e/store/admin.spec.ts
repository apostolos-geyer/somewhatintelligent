import { expect, test } from "@playwright/test";

/**
 * Store e2e — admin creates a product + variant.
 *
 * UNRUN DRAFT. Requires the FULL local stack. Set `STORE_E2E_URL` (bouncer-
 * fronted store base) and `STORE_E2E_ADMIN_EMAIL` / `STORE_E2E_ADMIN_PASSWORD`
 * to the seeded operator (`super@user.com` / `superuserdo`, whose `role` is
 * `admin`). Admin surfaces are gated in BOTH route beforeLoad AND every mutating
 * server fn, so a non-admin can't reach these. Skips when unset.
 */
const BASE = process.env.STORE_E2E_URL;
const EMAIL = process.env.STORE_E2E_ADMIN_EMAIL;
const PASSWORD = process.env.STORE_E2E_ADMIN_PASSWORD;
test.skip(!BASE || !EMAIL || !PASSWORD, "set STORE_E2E_URL + STORE_E2E_ADMIN_* to run");

test("admin signs in, creates a product, then adds a variant", async ({ page }) => {
  await page.goto(`${BASE}/admin`);

  // Gated → bounced to identity sign-in.
  await page.getByLabel(/email/i).fill(EMAIL!);
  await page.getByLabel(/password/i).fill(PASSWORD!);
  await page.getByRole("button", { name: /sign in/i }).click();

  // Admin catalog: create a product.
  await page.getByRole("link", { name: /catalog|products/i }).click();
  const title = `E2E Tee ${Date.now()}`;
  await page.getByLabel(/title/i).fill(title);
  await page.getByLabel(/price/i).fill("42");
  await page.getByRole("button", { name: /create|add product/i }).click();

  // Open the new product and add a variant (size + stock).
  await page.getByRole("link", { name: title }).click();
  await page.getByLabel(/size/i).fill("M");
  await page.getByLabel(/stock/i).fill("10");
  await page.getByRole("button", { name: /add variant/i }).click();

  await expect(page.getByText("M")).toBeVisible();
});
