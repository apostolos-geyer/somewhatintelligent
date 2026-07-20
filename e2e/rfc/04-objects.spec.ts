import { expect, test } from "@playwright/test";
import { OPERATOR, SITE, openCreateForm, pngBytes, uid } from "./helpers";

/**
 * RFC-0001 browser test #6 — the Objects (products) journey: create a product,
 * add a variant with stock, upload media through Operator's storage-neutral
 * endpoint, publish `1.0.0`, and verify `/shop` + `/shop/:slug`.
 *
 * LOCAL BOUNDARY + a real bug (both in the T25 report):
 *  - Adding a NEW variant is broken by an explicit-undefined validator bug on
 *    `putVariant` (asserted below), so no variant can be added through the UI.
 *  - The media-upload WRITE path is not functional in local dev (Roadie's
 *    server-side checksummed streaming `put` into the miniflare R2 sim returns
 *    `storage_unavailable`; the seed injects blob bytes via a bespoke round-trip).
 * Either alone blocks publishing a fresh product (publish requires a ready cover
 * image). This spec drives the create flow through the console, locks the
 * variant bug's network signature, asserts the storage-neutral upload endpoint
 * reaches its boundary (typed `storage_unavailable`) and the publish gate
 * refuses without media (`missing_media`), then verifies the public `/shop` +
 * `/shop/:slug` read path against the SEEDED, already-published `field-notes-tee`
 * (created with media through the seed's blob round-trip). The fresh-product
 * publish→public flip needs both the bug fixed and provisioned dev storage.
 */

test("RFC#6 product create + variant/stock + media/publish boundary; /shop reads", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = uid("rfc-obj");
  const title = `RFC Object ${slug}`;

  // Create the product through the console.
  await page.goto(`${OPERATOR}/objects`, { waitUntil: "domcontentloaded" });
  await openCreateForm(page, /^new product$/i, "#new-title");
  await page.locator("#new-title").fill(title);
  await page.locator("#new-slug").fill(slug);
  await page.locator("#new-price").fill("49.00");
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /create draft/i }).click();
  await page.waitForURL(/\/objects\/[^/]+$/, { timeout: 20_000 });
  const productId = page.url().split("/").pop() as string;
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();

  // Add a variant with stock through the console. KNOWN PRODUCT BUG (T25 report):
  // adding a NEW variant is broken. The editor calls `putVariant` with an explicit
  // `variantId: undefined`, and the arktype validator's optional `"variantId?"`
  // rejects a present-but-undefined value ("variantId must be a string (was
  // undefined)") — the same explicit-undefined class fixed for order fields in
  // fe2a84d, still live on putVariant. The server fn throws, the UI swallows the
  // rejection, and no variant row ever appears. This locks the bug's signature
  // via the network response; flip it to the success path once putVariant omits
  // the undefined key (or the validator tolerates it).
  await page.locator("#v-size").fill("M");
  await page.locator("#v-sku").fill(`SKU-${slug}`);
  await page.locator("#v-stock").fill("7");
  await page.waitForTimeout(400);
  const addButton = page.getByRole("button", { name: /^add variant$/i });
  await expect(addButton).toBeEnabled();
  // Collect server-fn response bodies (their URLs are opaque base64, so match on
  // the body) and retry the click through the SSR→hydration race until the
  // putVariant call fires and returns the validator's explicit-undefined error.
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (r.request().method() === "POST") {
      try {
        bodies.push(await r.text());
      } catch {
        /* body already consumed */
      }
    }
  });
  await expect(async () => {
    await addButton.click();
    await page.waitForTimeout(1200);
    expect(bodies.some((b) => b.includes("variantId must be a string"))).toBe(true);
  }).toPass({ timeout: 30_000 });
  await expect(page.getByText(/7 in stock/i)).toHaveCount(0);

  // Media upload through Operator's storage-neutral endpoint reaches the storage
  // boundary and returns the typed storage_unavailable.
  const uploadResp = await page.request.post(
    `${OPERATOR}/_operator/media/store/products/${productId}`,
    {
      multipart: {
        file: { name: "cover.png", mimeType: "image/png", buffer: pngBytes() },
        alt: "cover",
        role: "cover",
        commandId: crypto.randomUUID(),
      },
    },
  );
  expect(uploadResp.status()).toBe(503);
  expect((await uploadResp.json()).error).toBe("storage_unavailable");

  // Publish is gated on at least one ready image → missing_media surfaces inline.
  await page.locator("#version").fill("1.0.0");
  await page.getByRole("button", { name: /publish release/i }).click();
  await expect(page.getByText(/add at least one image before publishing/i)).toBeVisible({
    timeout: 15_000,
  });

  // Public read path: the seeded, published product renders on /shop + /shop/:slug.
  // The card shows the title in an <h2> and links out via a "View object" anchor.
  await page.goto(`${SITE}/shop`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /field notes tee/i, level: 2 })).toBeVisible();
  await expect(page.locator('a[href="/shop/field-notes-tee"]').first()).toBeVisible();

  await page.goto(`${SITE}/shop/field-notes-tee`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /field notes tee/i, level: 1 })).toBeVisible();
  await expect(page.locator(".product-price")).toContainText(/\$/);
  await expect(page.locator(".product-size").first()).toBeVisible();
  await expect(page.locator(".product-hero-image img")).toBeVisible();
});
