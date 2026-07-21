import { expect, test, type Page } from "@playwright/test";
import {
  OPERATOR,
  SITE,
  STORE,
  confirmDeletion,
  fillMarkdown,
  openCreateForm,
  publishRelease,
  uid,
} from "./helpers";

/**
 * RFC-0001 browser tests #11 and #12 — the hard-delete journey (RFC-0001 D8).
 *
 * #11 runs end to end on a Text (a published Publisher aggregate needs no media,
 * so it publishes locally): publish two versions, delete the retained non-active
 * release, then delete the whole published aggregate; prove the public route's
 * eligibility disappears (404) while the impact plan shows the retained/sibling
 * evidence that a hard-delete never erases.
 *
 * #12 (delete a product referenced by a completed order) cannot run locally for
 * three independent reasons, documented in that test: product hard-delete is not
 * wired into the Operator objects UI; a fresh product cannot be published (media
 * storage + the putVariant bug, see 04-objects); and a completed order cannot be
 * placed without the Bouncer-fronted authenticated checkout (see
 * 06-checkout-orders). It asserts the reachable boundary and records the gaps.
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

test("RFC#11 delete a retained release, then the published aggregate; public 404s, audit retained", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const slug = uid("rfc-del");
  const title = `RFC Delete ${slug}`;
  const bodyA = `Release one body ${slug}.`;
  const bodyB = `Release two body ${slug}.`;

  await createText(page, slug, title);
  await fillMarkdown(page, "Write…", bodyA);
  await publishRelease(page, "1.0.0");
  await fillMarkdown(page, "Write…", bodyB);
  await publishRelease(page, "1.1.0");

  // Public serves the live release (1.1.0).
  const pub = await page.context().newPage();
  await pub.goto(`${SITE}/writing/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(pub.getByText(bodyB)).toBeVisible();

  // Delete the RETAINED non-active release (1.0.0). Its row's Delete opens the
  // two-step dialog (confirm phrase = the version). The impact separates what is
  // deleted (this release) from what is retained (the sibling release) — the
  // audit-preserving guarantee made visible.
  const releaseRow = page.locator("div.justify-between").filter({ hasText: /^1\.0\.0/ });
  await releaseRow.getByRole("button", { name: "Delete", exact: true }).click();
  const releaseImpact = await confirmDeletion(page, "1.0.0");
  expect(releaseImpact).toMatch(/deletes/i);
  expect(releaseImpact).toMatch(/retained/i);
  // The impact renders the raw count key ("siblingReleases") — the sibling
  // release (1.1.0) is retained, not cascaded, when the retained release is cut.
  expect(releaseImpact).toMatch(/sibling/i);

  // The live release is untouched — public still serves 1.1.0.
  await pub.reload({ waitUntil: "domcontentloaded" });
  await expect(pub.getByText(bodyB)).toBeVisible();

  // Delete the whole published aggregate (Danger zone; confirm phrase = slug).
  // The plan warns the public page will 404 — that is the eligibility loss.
  await page.getByRole("button", { name: /delete text/i }).click();
  const aggregateImpact = await confirmDeletion(page, slug);
  expect(aggregateImpact).toMatch(/404/i);

  // Public eligibility is gone: the route now 404s.
  const gone = await pub.goto(`${SITE}/writing/${slug}`, { waitUntil: "domcontentloaded" });
  expect(gone?.status()).toBe(404);
});

test("RFC#12 product/order-snapshot deletion — reachable boundary + documented gaps", async ({
  page,
}) => {
  // GAP 1 — product hard-delete is NOT wired into the Operator objects UI. The
  // store worker exposes the RPC (planProductDeletion / deleteProduct, T13) and
  // the shared DeletionDialog is wired for texts/software/media, but the objects
  // detail route ships no delete affordance. Lock that current state so wiring it
  // flips this assertion.
  const slug = uid("rfc-del-obj");
  const title = `RFC Del Obj ${slug}`;
  await page.goto(`${OPERATOR}/objects`, { waitUntil: "domcontentloaded" });
  await openCreateForm(page, /^new product$/i, "#new-title");
  await page.locator("#new-title").fill(title);
  await page.locator("#new-slug").fill(slug);
  await page.locator("#new-price").fill("25.00");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /create draft/i }).click();
  await page.waitForURL(/\/objects\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /delete product|delete object/i })).toHaveCount(0);

  // GAP 2 + boundary — the order snapshot (title/size/price captured on the order
  // item) is server-owned and gated behind the buyer session; a completed order
  // that references this product cannot be placed locally (no Bouncer-fronted
  // authenticated checkout, see 06-checkout-orders), so the delete-with-retained-
  // order flow is not exercisable here. The reachable boundary: order reads are
  // server-authoritative (401 unauthenticated), which is what keeps the snapshot
  // out of client reach in the first place.
  const orderRes = await page.request.get(`${STORE}/api/store/orders/SI-DEMO-0001`, {
    failOnStatusCode: false,
  });
  expect(orderRes.status()).toBe(401);
});
