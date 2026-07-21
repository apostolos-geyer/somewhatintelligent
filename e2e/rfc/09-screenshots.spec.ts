import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { OPERATOR, SITE } from "./helpers";

/**
 * RFC-0001 browser test #14 — capture desktop and mobile screenshots of the
 * public and operator paths. Artifacts attach to the Playwright HTML report
 * (`bun run test:e2e:report`), matching `smoke.spec.ts`'s attachment convention;
 * full-page PNGs also land under `test-results/` via the attachment store.
 */

const DESKTOP = { width: 1280, height: 800 };
const MOBILE = { width: 390, height: 844 };

// Public surfaces (Site) + operator surfaces (console). Operator needs a moment
// for the SSR shell to hydrate before it paints its data.
const PUBLIC_PATHS: Array<[string, string]> = [
  ["home", `${SITE}/`],
  ["shop", `${SITE}/shop`],
  ["product", `${SITE}/shop/field-notes-tee`],
  ["writing", `${SITE}/writing`],
  ["software", `${SITE}/software`],
];

const OPERATOR_PATHS: Array<[string, string]> = [
  ["operator-overview", `${OPERATOR}/`],
  ["operator-objects", `${OPERATOR}/objects`],
  ["operator-orders", `${OPERATOR}/orders`],
];

async function shoot(
  page: Page,
  testInfo: TestInfo,
  label: string,
  url: string,
  device: "desktop" | "mobile",
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Give client islands / the operator SPA a beat to paint.
  await page.waitForTimeout(1500);
  const body = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${device}-${label}`, { body, contentType: "image/png" });
}

test("RFC#14 desktop screenshots of public + operator paths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize(DESKTOP);
  for (const [label, url] of [...PUBLIC_PATHS, ...OPERATOR_PATHS]) {
    await shoot(page, testInfo, label, url, "desktop");
  }
  // Sanity: at least the public shop rendered the seeded product's title card.
  await page.goto(`${SITE}/shop`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /field notes tee/i, level: 2 })).toBeVisible();
});

test("RFC#14 mobile screenshots of public + operator paths", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize(MOBILE);
  for (const [label, url] of [...PUBLIC_PATHS, ...OPERATOR_PATHS]) {
    await shoot(page, testInfo, label, url, "mobile");
  }
  await page.goto(`${OPERATOR}/`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
});
