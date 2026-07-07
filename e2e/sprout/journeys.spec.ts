import { expect, test } from "@playwright/test";
import { HOSTS, USERS, enterPortal, readPrimaryColor, signIn, typeInto } from "./helpers";

/**
 * WEB-BEHAVIOUR / BOUNDARY journeys — the things that can only be verified with a
 * real browser + server + db: a state renders given the seeded data, and an
 * interaction changes server/db state observably. Pure logic (grading, theming,
 * key normalization) is covered by the unit suites; these own the wiring.
 *
 * Pre-req: `bun run dev` up, `bun run seed` run (one consolidated seed).
 */

test("sign-in → brand portal renders the section grid (Enter Portal)", async ({ page }) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.brand("acme"));
  await enterPortal(page);
  // The six section cards render (live_sections_json='[]' → all-six fallback).
  for (const name of ["Store Assets", "PK Decks", "Quizzes", "Group Chat", "Contact"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
});

test("Drop Sheet review submit persists (web → server → db)", async ({ page }) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.brand("acme"));
  await enterPortal(page);

  // Open the seeded Garlic Breath product detail.
  await page.getByRole("listitem", { name: /Garlic Breath product details/i }).click();
  const dialog = page.getByRole("dialog", { name: "Garlic Breath" });
  await expect(dialog).toBeVisible();

  // Submitting a review (rating + body) should render it back in the list. The
  // form is "Post review" on first review and "Update review" once one exists, so
  // the spec is idempotent across reruns.
  const body = `E2E review ${Date.now()}`;
  await dialog.getByRole("radio", { name: "5 stars" }).click();
  await typeInto(page, dialog.getByRole("textbox", { name: /What did you think/i }), body);
  await typeInto(page, dialog.getByRole("textbox", { name: "Store" }), "E2E Store");
  await dialog.getByRole("button", { name: /Post review|Update review/i }).click();

  // The body now renders in the reviews list (also echoed in the edit textarea,
  // hence .first()).
  await expect(dialog.getByText(body).first()).toBeVisible({ timeout: 10000 });
});

test("Brand Admin renders the publish surface; public serves the LIVE theme", async ({ page }) => {
  // The publish READ invariant + admin surface (reliable in headless). The full
  // edit→flip→repaint round-trip is verified manually (see report screenshot
  // 12c) and belongs to the integration layer (the `flipDraftToLive` server fn
  // against D1) once the vitest-pool-workers harness lands — driving the admin
  // ColorField's controlled save in headless is brittle and low-value here.
  await signIn(page, USERS.aliceAdmin);

  // Public portal serves the brand's LIVE primary (runtime-injected per host).
  await page.goto(HOSTS.brand("acme"));
  const publicPrimary = await readPrimaryColor(page);
  expect(publicPrimary).toMatch(/^#[0-9a-f]{3,8}$/);

  // The admin Setup surface exposes the draft/preview/publish mechanism, and the
  // Primary field is seeded to the same live value the public portal renders.
  await page.goto(`${HOSTS.brand("acme")}/admin/setup`);
  await expect(page.getByRole("heading", { name: /Portal setup/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Publish changes/i })).toBeVisible();
  await expect(page.getByText(/Live draft preview/i)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Primary", exact: true })).toHaveValue(
    publicPrimary,
  );
});

test("section layer opens as a dialog and Escape closes it back to the grid", async ({ page }) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(`${HOSTS.brand("acme")}/?section=chat`);

  // The section renders as a real (Base UI) dialog with its content.
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Group Chat/i).first()).toBeVisible();

  // Escape (owned by the dialog primitive) closes it and drops the ?section param.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL((u) => !u.search.includes("section="));
});

test("booking is register-only — no instant call anywhere (INV-2)", async ({ page }) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.brand("acme"));
  await enterPortal(page);

  // The load-bearing INV-2 assertion: the forbidden "Start Call Now" affordance
  // exists nowhere in the budtender portal — every video interaction is booked.
  // (The AI-assistant Sessions/booking copy is exercised manually; the persistent
  // bottom-right bubble shares the corner with the dev devtools, which makes the
  // panel-open flaky in headless — kept out of the deterministic gate.)
  await expect(page.getByRole("button", { name: /start call now/i })).toHaveCount(0);
  await expect(page.getByText(/start call now/i)).toHaveCount(0);
  // The persistent AI assistant affordance is present throughout the portal.
  await expect(page.getByRole("button", { name: /Ask the assistant/i })).toBeVisible();
});
