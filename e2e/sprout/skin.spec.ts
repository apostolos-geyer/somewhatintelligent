import { expect, test } from "@playwright/test";
import { HOSTS, readPrimaryColor } from "./helpers";

/**
 * WEB BEHAVIOUR — runtime per-brand skinning (INV-4 / INV-14, "one engine,
 * infinite skins"). The same worker serves both hosts; only the host→brand
 * resolution + injected CSS vars differ. No auth needed (public landing).
 *
 * Pure unit tests already cover `brandThemeToCss` / `slugFromHost`; this asserts
 * the *rendered* end-to-end result: two hosts → two different primaries, each
 * with its own wordmark, from one codebase.
 */
test.describe("runtime brand skin", () => {
  test("acme and beta render distinct primaries + wordmarks from one engine", async ({ page }) => {
    await page.goto(HOSTS.brand("acme"));
    await expect(page.getByText("Acme Cannabis").first()).toBeVisible();
    const acmePrimary = await readPrimaryColor(page);

    await page.goto(HOSTS.brand("beta"));
    await expect(page.getByText("Beta Greens").first()).toBeVisible();
    const betaPrimary = await readPrimaryColor(page);

    expect(acmePrimary).not.toBe(betaPrimary);
  });

  test("an unregistered brand subdomain is not-found", async ({ page }) => {
    const res = await page.goto(HOSTS.brand("nope-not-a-brand"));
    // The root route throws notFound() for a slug with no brand row.
    expect(res?.status()).toBeGreaterThanOrEqual(400);
  });
});
