import { expect, test } from "@playwright/test";
import { HOSTS, USERS, enterPortal, signIn } from "./helpers";

/**
 * WEB-BEHAVIOUR / BOUNDARY journeys for the team's wish-list features (the things
 * only a real browser + server + db can verify). Pure logic + the D1 boundary are
 * covered by the unit + `*.itest.ts` suites; these own the wiring.
 *
 * Pre-req: `bun run dev` up, `bun run seed` run (one consolidated seed)
 * (seeds the rotational/wholesale Garlic Breath + an alice-owned Shipped request).
 */

test("Drop Sheet detail shows tags, rotational, avg rating, wholesale link + Appears in", async ({
  page,
}) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.brand("acme"));
  await enterPortal(page);

  await page.getByRole("listitem", { name: /Garlic Breath product details/i }).click();
  const dialog = page.getByRole("dialog", { name: "Garlic Breath" });
  await expect(dialog).toBeVisible();

  // Rotational callout chip + the descriptor/province chips.
  await expect(dialog.getByText("Rotational").first()).toBeVisible();
  await expect(dialog.getByText("Wholesale").first()).toBeVisible();
  await expect(dialog.getByText("ON").first()).toBeVisible();

  // Average rating surfaced (3 seeded reviews → avg 4.0).
  await expect(dialog.getByText(/4\.0/)).toBeVisible();
  await expect(dialog.getByText(/3 reviews/)).toBeVisible();

  // Provincial wholesale link-out points at the seeded URL.
  const wholesale = dialog.getByRole("link", { name: /Provincial wholesale/i });
  await expect(wholesale).toHaveAttribute("href", /ocs\.ca/);

  // "Appears in" lists the linked PK deck + the feed post referencing the product.
  await expect(dialog.getByRole("heading", { name: /Appears in/i })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Product Deck/i })).toBeVisible();
});

test("Contact surface offers Area of store + Type of request + a Book-a-call tab", async ({
  page,
}) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.brand("acme"));
  await enterPortal(page);
  // Open the Contact section layer from the grid (client-side, no reload).
  await page.getByRole("listitem", { name: /Section.*Contact/i }).click();

  await expect(page.getByRole("combobox", { name: "Type of request" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Area of store" })).toBeVisible();

  // The Book-a-call tab swaps the message form for the bookable-slots panel.
  await page.getByRole("tab", { name: "Book a call" }).click();
  await expect(page.getByRole("heading", { name: "Book a call" })).toBeVisible();
});

test("Proof-of-display: a budtender confirms a shipped request → Deployed (web → server → db)", async ({
  page,
}) => {
  await signIn(page, USERS.aliceAdmin);
  // The standalone requests route renders the same MyRequests status view.
  await page.goto(`${HOSTS.brand("acme")}/requests`);

  // The seeded alice-owned Shipped request (Tent Card) exposes the confirm control.
  // Idempotent across reruns: if a prior run already deployed it, the control is
  // gone and the confirmation note is already present. The list renders from a
  // client fetch, so wait for EITHER state before deciding (avoids a render race).
  const confirm = page.getByRole("button", { name: /Confirm display is up/i }).first();
  const note = page.getByText(/You confirmed this display is up/i).first();
  await expect(confirm.or(note)).toBeVisible({ timeout: 15000 });
  if (await confirm.isVisible().catch(() => false)) {
    await confirm.click();
  }

  // It flips to Deployed and shows the confirmation note (server → db round-trip).
  await expect(page.getByText(/You confirmed this display is up/i).first()).toBeVisible({
    timeout: 10000,
  });
});
