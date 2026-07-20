import { expect, test, type Page } from "@playwright/test";
import { OPERATOR, SITE, openCreateForm, pngBytes, uid, waitAutosaved } from "./helpers";

/**
 * RFC-0001 browser tests #4 and #5 — the Software (systems registry) journey.
 * #4 creates a record with title, deck (blurb), "what it is" copy, and an
 * outbound destination URL, publishes it, and verifies `/software` +
 * `/software/:slug` (including the published "Last updated" value). #5 edits the
 * draft and proves the public record is frozen until the snapshot is
 * republished, with the draft only surfacing through Operator's signed preview
 * iframe in between.
 *
 * LOCAL BOUNDARY: the primary image is OPTIONAL for publishing (the record
 * renders with a placeholder without one), so these run end to end. The media
 * UPLOAD write path itself is not functional in local dev — Roadie's server-side
 * checksummed streaming `put` into the miniflare R2 sim returns
 * `storage_unavailable` (bindings are correct; the seed injects blob bytes via a
 * bespoke round-trip). #4 asserts that upload boundary explicitly; the primary
 * image on a public record needs live/provisioned dev storage (T25 report).
 */

async function createSoftware(page: Page, slug: string, title: string): Promise<string> {
  await page.goto(`${OPERATOR}/software`, { waitUntil: "domcontentloaded" });
  await openCreateForm(page, /^new entry$/i, "#new-title");
  await page.locator("#new-title").fill(title);
  await page.locator("#new-slug").fill(slug);
  await page.getByRole("button", { name: /create draft/i }).click();
  await page.waitForURL(/\/software\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /publish snapshot/i })).toBeVisible();
  return page.url().split("/").pop() as string;
}

/**
 * Save the Details section. Stays reload-free — after the client-side create
 * navigation the SPA is already hydrated, so fills register; the only race is
 * React flushing a controlled input's onChange into state before the save reads
 * it, so settle briefly and confirm the input reflects the value before saving.
 */
async function saveDetails(
  page: Page,
  fields: { deck?: string; destination?: string; action?: string },
): Promise<void> {
  if (fields.deck !== undefined) await page.locator("#deck").fill(fields.deck);
  if (fields.destination !== undefined) await page.locator("#destination").fill(fields.destination);
  if (fields.action !== undefined) await page.locator("#action").fill(fields.action);
  // Let each controlled-input onChange flush into state before saving.
  await page.waitForTimeout(500);
  if (fields.destination !== undefined)
    await expect(page.locator("#destination")).toHaveValue(fields.destination);
  if (fields.deck !== undefined) await expect(page.locator("#deck")).toHaveValue(fields.deck);
  await page.getByRole("button", { name: /save details/i }).click();
  await expect(page.getByText(/^Saved\.$/).first()).toBeVisible({ timeout: 15_000 });
  // Let the shared revision state propagate before the next mutation.
  await page.waitForTimeout(500);
}

async function setWhatItIs(page: Page, body: string): Promise<void> {
  const field = page.getByPlaceholder("Describe the system…");
  await field.click();
  await field.pressSequentially(body, { delay: 3 });
  await waitAutosaved(page);
  await page.waitForTimeout(800);
}

async function publishSnapshot(page: Page): Promise<void> {
  await page.getByRole("button", { name: /publish snapshot/i }).click();
  // The transient "Published." note is cleared when the loader invalidates and
  // the editor remounts with state === "published"; the durable success signal
  // is the Retire control that only that published state renders.
  await expect(page.getByRole("button", { name: /^retire$/i })).toBeVisible({ timeout: 20_000 });
}

/**
 * After publishing, the loader invalidates and the editor remounts with
 * `state === "published"` (a "Retire" control appears). Waiting for it settles
 * the remount so a following edit re-seeds the shared revision cleanly rather
 * than sending a stale expectedRevision.
 */
async function waitPublishedSettled(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: /^retire$/i })).toBeVisible({ timeout: 20_000 });
}

test("RFC#4 create + publish software; Site renders /software and /software/:slug", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = uid("rfc-sw");
  const title = `RFC System ${slug}`;
  const deck = `One-line blurb for ${slug}.`;
  const whatItIs = `What ${slug} is: a small tool.`;
  const destination = `https://example.com/${slug}`;

  const softwareId = await createSoftware(page, slug, title);
  await saveDetails(page, { deck, destination, action: "Open" });
  await setWhatItIs(page, whatItIs);

  // The optional primary-image UPLOAD reaches the storage boundary and returns
  // the typed storage_unavailable (Operator → Publisher ingest wiring is correct
  // end to end; only the local blob backend is unavailable). The record still
  // publishes below — the image is optional.
  const uploadResp = await page.request.post(
    `${OPERATOR}/_operator/media/publisher/software/${softwareId}`,
    {
      multipart: {
        file: { name: "x.png", mimeType: "image/png", buffer: pngBytes() },
        alt: "primary",
        role: "cover",
        commandId: crypto.randomUUID(),
      },
    },
  );
  expect(uploadResp.status()).toBe(503);
  expect((await uploadResp.json()).error).toBe("storage_unavailable");

  await publishSnapshot(page);

  // /software index lists the published record.
  await page.goto(`${SITE}/software`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
  await expect(page.getByText(deck).first()).toBeVisible();

  // /software/:slug renders the full record incl. the published "Last updated".
  await page.goto(`${SITE}/software/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  await expect(page.getByText(deck).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: /what it is/i })).toBeVisible();
  await expect(page.getByText(whatItIs)).toBeVisible();
  await expect(page.locator(`a[href="${destination}"]`)).toBeVisible();
  const lastUpdated = page.getByRole("heading", { name: /last updated/i });
  await expect(lastUpdated).toBeVisible();
  await expect(lastUpdated.locator("xpath=following-sibling::p[1]")).not.toBeEmpty();
});

test("RFC#5 software draft edits stay private (preview only) until republished", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const slug = uid("rfc-sw");
  const title = `RFC Draft System ${slug}`;
  const deckA = `Released blurb ${slug}.`;
  const deckB = `Revised draft blurb ${slug}.`;
  const destination = `https://example.com/${slug}`;

  await createSoftware(page, slug, title);
  await saveDetails(page, { deck: deckA, destination, action: "Open" });
  await setWhatItIs(page, `Body for ${slug}.`);
  await publishSnapshot(page);
  await waitPublishedSettled(page);

  // Public shows release A.
  const pub = await page.context().newPage();
  await pub.goto(`${SITE}/software/${slug}`, { waitUntil: "domcontentloaded" });
  await expect(pub.getByText(deckA).first()).toBeVisible();

  // Edit the deck to B and save the draft — but do NOT republish.
  await saveDetails(page, { deck: deckB });

  // Preview proof: the signed preview iframe shows draft B; the framed response
  // carries noindex + no-store.
  const previewResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/__preview") && r.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /show preview/i }).click();
  const previewResponse = await previewResponsePromise;
  expect(previewResponse.headers()["x-robots-tag"] ?? "").toMatch(/noindex/i);
  expect(previewResponse.headers()["cache-control"] ?? "").toMatch(/no-store/i);
  const previewFrame = page.frameLocator('iframe[name="si-operator-preview"]');
  await expect(previewFrame.getByText(deckB).first()).toBeVisible({ timeout: 15_000 });

  // Public is still release A.
  await pub.reload({ waitUntil: "domcontentloaded" });
  await expect(pub.getByText(deckA).first()).toBeVisible();
  await expect(pub.getByText(deckB)).toHaveCount(0);

  // Republish → public flips to B.
  await publishSnapshot(page);
  await pub.reload({ waitUntil: "domcontentloaded" });
  await expect(pub.getByText(deckB).first()).toBeVisible();
});
