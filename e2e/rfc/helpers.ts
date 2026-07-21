import { expect, type Page } from "@playwright/test";

/**
 * Shared fixtures for the RFC-0001 browser suite (exec-plan 0004 T25). The tests
 * drive the RUNNING local dev fleet dev-direct (no Bouncer): Site on :4321,
 * Operator on :8792, Store on :8793. Operator resolves the DEV_OPERATOR actor
 * automatically (no Access, no sign-in). Every base is env-overridable so the
 * same specs can point at a Bouncer-fronted staging fleet.
 *
 * Dev-direct has one structural gap the specs work around: the Store HTTP API is
 * only reachable same-origin as `/api/store/*` behind Bouncer's passthrough
 * mount, which does not exist locally — so the authenticated checkout / order /
 * fulfilment journey (RFC items 8–10, 12) cannot complete through Site's UI here.
 * Those specs assert up to the reachable boundary and say so; the public
 * publish/preview/delete journeys (items 1–7, 11, 13, 14) run end to end.
 */
export const SITE = process.env.RFC_SITE_URL ?? "http://127.0.0.1:4321";
export const OPERATOR = process.env.RFC_OPERATOR_URL ?? "http://127.0.0.1:8792";
export const STORE = process.env.RFC_STORE_URL ?? "http://127.0.0.1:8793";

/** Timestamped, collision-resistant slug so re-runs never clash. */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/** A minimal but valid 1×1 PNG for the media-upload flows. */
export function pngBytes(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==",
    "base64",
  );
}

/**
 * Open an Operator "New …" create form, tolerating the SSR→hydration race: the
 * button exists in the server HTML before React attaches its onClick, so an early
 * click is a no-op. Retry clicking until the first field actually appears.
 */
export async function openCreateForm(
  page: Page,
  buttonName: RegExp,
  firstFieldSelector: string,
): Promise<void> {
  // No networkidle wait — the Vite dev HMR socket keeps the page perpetually
  // "busy". Retry the click until React has hydrated and the form opens. Under
  // cumulative load the operator dev server occasionally serves a page that never
  // hydrates; a one-time reload partway through recovers it.
  let reloaded = false;
  const started = Date.now();
  await expect(async () => {
    if (!reloaded && Date.now() - started > 15_000) {
      reloaded = true;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    if (!(await page.locator(firstFieldSelector).isVisible())) {
      const button = page.getByRole("button", { name: buttonName }).first();
      if (await button.isVisible()) await button.click();
    }
    await expect(page.locator(firstFieldSelector)).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 45_000 });
}

/** Wait for the editor's autosave indicator to settle on "Saved". */
export async function waitAutosaved(page: Page): Promise<void> {
  await expect(page.getByRole("status").filter({ hasText: /saved/i }).first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Fill a MarkdownField (the long-form body / "what it is" editor) and wait for its
 * autosave to persist. `.fill()` does not drive this controlled component's
 * onChange, so type the value; the field is short in these specs.
 */
export async function fillMarkdown(page: Page, placeholder: string, text: string): Promise<void> {
  const field = page.getByPlaceholder(placeholder);
  await field.click();
  await field.pressSequentially(text, { delay: 3 });
  await waitAutosaved(page);
  // Let the editor's revision state propagate to the Publish control before a
  // caller publishes — the "Saved" indicator flips a beat before the bumped
  // revision reaches the publish handler, and publishing on the stale revision
  // would freeze a release snapshot that predates this body edit.
  await page.waitForTimeout(1000);
}

/**
 * Publish the currently-open Publisher/Store editor at `version` and wait for the
 * release to appear in the editor's Releases list. Works for texts, software, and
 * objects (all share the same Publish form + release list shape).
 */
export async function publishRelease(page: Page, version: string): Promise<void> {
  await page.locator("#version").fill(version);
  await page.getByRole("button", { name: /publish release/i }).click();
  // The release row (version text) renders after the loader re-validates. Scope to
  // avoid matching the version input, whose value is cleared on success.
  await expect(page.getByText(version, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

/** Read the store-price CAD string rendered on a Site product page's price line. */
export async function readShopPrice(page: Page): Promise<string> {
  return (await page.locator(".product-price").first().innerText()).trim();
}

/**
 * Upload one image through a same-origin operator media `<input type=file>`,
 * fill its alt, and submit. `fileInput` is the input locator; the sibling alt
 * input + "Upload image" submit live in the same dashed form. Waits for the busy
 * state to clear (the row appears once the parent loader re-validates).
 */
export async function uploadImage(
  page: Page,
  fileInputSelector: string,
  alt: string,
): Promise<void> {
  const input = page.locator(fileInputSelector);
  await input.setInputFiles({
    name: `${uid("img")}.png`,
    mimeType: "image/png",
    buffer: pngBytes(),
  });
  const form = input.locator("xpath=ancestor::form[1]");
  await form.getByLabel(/alt text/i).fill(alt);
  await form.getByRole("button", { name: /upload image/i }).click();
  // Submit disables → re-enables ("Uploading…" → "Upload image") when done.
  await expect(form.getByRole("button", { name: /upload image/i })).toBeEnabled({
    timeout: 30_000,
  });
}

/**
 * Drive the shared two-step DeletionDialog to completion: it plans on open, so
 * wait for the impact summary, type the confirm phrase, and execute. Returns the
 * planned impact text so a caller can assert retained/audit counts.
 */
export async function confirmDeletion(page: Page, confirmPhrase: string): Promise<string> {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Planning resolves into the impact summary (the confirm input appears).
  const confirmInput = dialog.locator("#delete-confirm");
  await expect(confirmInput).toBeVisible({ timeout: 20_000 });
  const impactText = await dialog.innerText();
  await confirmInput.fill(confirmPhrase);
  await dialog.getByRole("button", { name: /delete permanently/i }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  return impactText;
}
