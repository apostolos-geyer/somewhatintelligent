import { expect, test } from "@playwright/test";

/**
 * Store e2e — live Stripe elements checkout: Stripe-collected shipping address
 * + test card → webhook → order paid with the address backfilled.
 *
 * Requires the full local stack + a seeded pre-verified user (STORE_E2E_URL /
 * STORE_E2E_EMAIL / STORE_E2E_PASSWORD), Stripe test keys in
 * workers/store/.dev.vars, and `stripe listen --skip-verify --forward-to
 * <store>/hooks/store` running. Skips when env is unset; self-skips when the
 * manual stub renders (Stripe unconfigured).
 */
const BASE = process.env.STORE_E2E_URL;
const EMAIL = process.env.STORE_E2E_EMAIL;
const PASSWORD = process.env.STORE_E2E_PASSWORD;
test.skip(!BASE || !EMAIL || !PASSWORD, "set STORE_E2E_URL + STORE_E2E_EMAIL/PASSWORD to run");

test("Stripe collects the address; webhook flips the order to paid and backfills it", async ({
  page,
}) => {
  test.setTimeout(150_000);

  await page.goto(BASE!);
  await page
    .getByRole("link", { name: /field notes tee/i })
    .first()
    .click();
  await page.getByRole("button", { name: "M", exact: true }).click();
  await page.getByRole("button", { name: /add to cart/i }).click();

  // Sign in (identity), then navigate to checkout explicitly — the dev-direct
  // sign-in bounce does not return to the store.
  await page.goto(`${BASE}/checkout`);
  await page.getByRole("textbox", { name: /email/i }).fill(EMAIL!);
  await page.getByRole("textbox", { name: /^password$/i }).fill(PASSWORD!);
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForLoadState("networkidle");
  await page.goto(`${BASE}/checkout`);

  const continueBtn = page.getByRole("button", { name: /continue to payment/i });
  const placeOrderBtn = page.getByRole("button", { name: /place order/i });
  await expect(continueBtn.or(placeOrderBtn)).toBeVisible();
  test.skip(await placeOrderBtn.isVisible(), "Stripe unconfigured — manual stub rendered");
  await continueBtn.click();

  // Shipping: Stripe's ShippingAddressElement iframe. Fill line1, dismiss the
  // autocomplete, and complete the expanded manual fields.
  const address = page.frameLocator('iframe[title*="address" i]');
  await address.getByLabel(/full name/i).fill("Ada Lovelace");
  await address
    .getByLabel(/^address/i)
    .first()
    .pressSequentially("220 Yonge St");
  await page.keyboard.press("Escape");
  await address.getByLabel(/city/i).fill("Toronto");
  await address.getByLabel(/province/i).selectOption({ label: "Ontario" });
  await address.getByLabel(/postal/i).fill("M5V 2T6");

  // Card: the Payment Element accordion.
  const payment = page.frameLocator('iframe[title="Secure payment input frame"]');
  await payment.getByText("Card", { exact: true }).click();
  await payment.getByPlaceholder(/1234 1234 1234/).pressSequentially("4242424242424242");
  await payment.getByPlaceholder(/MM \/ YY/i).pressSequentially("1234");
  await payment.getByPlaceholder(/CVC/i).pressSequentially("123");

  await page.getByRole("button", { name: /^pay \$/i }).click();

  await expect(page).toHaveURL(/\/checkout\/return/, { timeout: 30_000 });
  await expect(page.getByText(/payment received/i)).toBeVisible({ timeout: 50_000 });

  // Order is paid and carries the Stripe-collected, webhook-backfilled address.
  await page.getByRole("button", { name: /view order/i }).click();
  await expect(page).toHaveURL(/\/orders\/SI-/);
  await expect(page.getByText(/paid/i).first()).toBeVisible();
  await expect(page.getByText(/220 Yonge St/i)).toBeVisible({ timeout: 15_000 });
});
