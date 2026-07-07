import { expect, test } from "@playwright/test";

/**
 * Hermetic smoke test — proves the Playwright harness + Chromium engine work
 * with NO network or app dependency. Safe to run anywhere, anytime, and the
 * canonical "is browser tooling provisioned?" check.
 */
test("chromium renders and screenshots (hermetic)", async ({ page }, testInfo) => {
  await page.setContent(`
    <!doctype html><html><head><title>greenroom e2e smoke</title></head>
    <body style="font-family:system-ui;padding:40px">
      <h1 data-testid="headline">Playwright engine is alive</h1>
      <p id="ua"></p>
      <script>document.getElementById('ua').textContent = navigator.userAgent</script>
    </body></html>`);

  await expect(page.getByTestId("headline")).toHaveText("Playwright engine is alive");
  await expect(page).toHaveTitle("greenroom e2e smoke");

  const ua = await page.locator("#ua").innerText();
  expect(ua).toContain("Chrome");

  // Attach a screenshot so it appears in `bun run test:e2e:report`.
  await testInfo.attach("smoke", { body: await page.screenshot(), contentType: "image/png" });
});
