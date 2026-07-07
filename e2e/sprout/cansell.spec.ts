import { expect, test } from "@playwright/test";
import { HOSTS, USERS, signIn } from "./helpers";

/**
 * WEB-BEHAVIOUR / BOUNDARY journey for Idea 1 — "log in for budtenders, verify
 * with a valid CanSell". A signed-in budtender on the Hub submits their CanSell
 * (cert number + required expiry) via the soft-prompt card → the card flips to the
 * "Under review" pending state (web → registerCredentialUpload → submitCredential
 * → db → getMyCredential refresh).
 *
 * The file upload DEGRADES when roadie is inert (local dev): the card submits
 * file-less, so this asserts the resulting pending/awaiting-review state (the
 * submission is recorded with the number + expiry), not a stored blob.
 *
 * HYDRATION RACE: the Hub apex is the heaviest page in the app, so under vite dev
 * it streams ~200 modules before the client server-fn transport is wired. A fill +
 * click that lands before hydration is a no-op — the value is wiped by a late
 * hydration pass and the handler isn't attached yet — exactly the case the
 * `enterPortal` helper guards against. So we re-fill and re-click inside
 * `expect(...).toPass()` until the submit actually goes out; `submitCredential` is
 * an idempotent UPSERT, so re-firing is harmless. This waits for genuine
 * interactivity (a real user can't click before the page hydrates either) — it
 * does not loosen the assertion.
 *
 * REPRODUCIBLE / RERUN-SAFE: `bun run seed` (scripts/seed.ts) clears alice's
 * budtender_credentials row, so a fresh run starts in the `missing` state with the
 * upload form. But the journey itself submits (leaving the row `pending`), so a
 * re-run WITHOUT a re-seed finds the card already pending — like wishlist's
 * proof-of-display test, we therefore only drive the submit when the card isn't
 * already under review, and always assert the end state.
 *
 * Pre-req: `bun run dev` up, `bun run seed` run (one consolidated seed).
 */
test("CanSell soft prompt: a budtender submits on the Hub → card shows 'Under review'", async ({
  page,
}) => {
  await signIn(page, USERS.aliceAdmin);
  await page.goto(HOSTS.hub);

  // The CanSell card renders on the Hub scroll (right after Your Portals).
  await expect(page.getByRole("heading", { name: "Your CanSell" })).toBeVisible({ timeout: 15000 });

  // The "Under review" BADGE (exact, so it doesn't also match the "…is under
  // review" paragraph) is the definitive pending signal.
  const underReview = page.getByText("Under review", { exact: true });

  // Drive the submit only from a clean (missing) slate. A re-run without a
  // re-seed finds alice already pending from a prior run — skip straight to the
  // end-state assertion.
  if ((await underReview.count()) === 0) {
    await expect(page.getByText("Action needed")).toBeVisible();

    const number = page.locator("#cansell-number");
    const expiry = page.locator("#cansell-expiry");
    const submit = page.getByRole("button", { name: "Submit for review" });

    // Required expiry (~2 years out) + the optional cert number; computed once so
    // the values are stable across retries. The file input stays empty (roadie
    // inert → file-less submit), and the journey still records the number/expiry.
    const numberValue = `CS-E2E-${Date.now()}`;
    const expiryValue = new Date(Date.now() + 730 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    // Re-fill + re-click until the card flips to "Under review". Each attempt
    // re-enters the values (a pre-hydration fill can be wiped) and re-issues the
    // click (a pre-hydration click is a no-op); once the client server-fn
    // transport is live, submitCredential POSTs and getMyCredential refreshes.
    await expect(async () => {
      if ((await underReview.count()) > 0) return;
      await number.fill(numberValue);
      await expiry.fill(expiryValue);
      await expect(expiry).toHaveValue(expiryValue);
      await submit.click({ timeout: 2000 });
      await expect(underReview).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 45000 });
  }

  // The pending state: the "Under review" badge + the awaiting-review copy.
  await expect(underReview).toBeVisible();
  await expect(page.getByText(/your cansell is under review/i)).toBeVisible();
});
