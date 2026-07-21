import { expect, test, type Page } from "@playwright/test";
import { OPERATOR, SITE, fillMarkdown, openCreateForm, publishRelease, uid } from "./helpers";

/**
 * RFC-0001 browser tests #2 and #3 — the Texts publishing journey, plus the
 * draft-preview proof (exec-plan T23): create a text in Operator, autosave, and
 * publish a versioned release that appears on Site's `/writing/:slug`; then prove
 * the public release is frozen while a draft edit only surfaces through Operator's
 * signed preview iframe, until a new version publishes.
 *
 * The Operator page stays put after the client-side create-navigation (so it
 * stays hydrated); public checks run on a second page against Site.
 */

async function createText(page: Page, slug: string, title: string): Promise<void> {
  await page.goto(`${OPERATOR}/texts`, { waitUntil: "domcontentloaded" });
  await openCreateForm(page, /^new text$/i, "#new-title");
  await page.locator("#new-title").fill(title);
  await page.locator("#new-slug").fill(slug);
  await page.getByRole("button", { name: /create draft/i }).click();
  await page.waitForURL(/\/texts\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /publish release/i })).toBeVisible();
}

async function setBody(page: Page, body: string): Promise<void> {
  await fillMarkdown(page, "Write…", body);
}

test("RFC#2 create + publish a text; Site renders /writing/:slug", async ({ page }) => {
  const slug = uid("rfc-text");
  const title = `RFC Text ${slug}`;
  const body = `Published body ${slug}.`;

  await createText(page, slug, title);
  await setBody(page, body);
  await publishRelease(page, "1.0.0");

  await page.goto(`${SITE}/writing/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByText(/version 1\.0\.0/i)).toBeVisible();
});

test("RFC#3 draft edits stay private (preview only) until republished", async ({ page }) => {
  const slug = uid("rfc-text");
  const title = `RFC Draft ${slug}`;
  const bodyA = `Original release body ${slug}.`;
  const bodyB = `Revised draft body ${slug}.`;

  await createText(page, slug, title);
  await setBody(page, bodyA);
  await publishRelease(page, "1.0.0");

  // Public shows release A (separate page, so Operator stays hydrated).
  const pub = await page.context().newPage();
  await pub.goto(`${SITE}/writing/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(pub.getByText(bodyA)).toBeVisible();

  // Edit the draft to B (autosaved), but do NOT publish.
  await setBody(page, bodyB);

  // Preview proof: the signed preview iframe shows the DRAFT (B), and the framed
  // response carries noindex + no-store.
  const previewResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/__preview") && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /show preview/i }).click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.headers()["x-robots-tag"] ?? "").toMatch(/noindex/i);
  expect(previewResponse.headers()["cache-control"] ?? "").toMatch(/no-store/i);

  const previewFrame = page.frameLocator('iframe[name="si-operator-preview"]');
  await expect(previewFrame.getByText(bodyB)).toBeVisible({ timeout: 15_000 });

  // Public is still release A — the draft edit has not surfaced.
  await pub.reload({ waitUntil: "domcontentloaded" });
  await expect(pub.getByText(bodyA)).toBeVisible();
  await expect(pub.getByText(bodyB)).toHaveCount(0);

  // Publish B as 1.1.0 → public flips to B.
  await publishRelease(page, "1.1.0");
  await pub.reload({ waitUntil: "domcontentloaded" });
  await expect(pub.getByText(bodyB)).toBeVisible();
  await expect(pub.getByText(/version 1\.1\.0/i)).toBeVisible();
});
