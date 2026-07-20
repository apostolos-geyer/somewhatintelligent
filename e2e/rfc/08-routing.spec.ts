import { expect, test } from "@playwright/test";
import { SITE } from "./helpers";

/**
 * RFC-0001 browser test #13 — Account stays served by Identity at `/account`,
 * Site never serves it, and Site is passthrough while Identity receives VMF
 * rewriting.
 *
 * The full assertion is a Bouncer routing invariant: `/account` → Identity via
 * VMF (mount-prefix strip + asset/`Location`/`Set-Cookie` rewrite + a
 * `<meta name="si-mount" content="/account">` announcement), `/` → Site
 * passthrough (no mount meta, no root asset rewrite). Bouncer is not in the
 * dev-direct graph, so the reachable local assertions are:
 *  - Site does NOT own `/account` — the request is not a Site page (Site's
 *    catch-all must not swallow the Identity mount);
 *  - Site pages carry NO VMF mount metadata (`<meta name="si-mount">`), matching
 *    the "Site remains passthrough" half of the invariant;
 *  - Identity's own dev origin serves the account surface.
 * The Bouncer host-level VMF-vs-passthrough split is covered by Bouncer's own
 * route tests; point `RFC_SITE_URL` at a Bouncer-fronted host to assert it here.
 */

test("RFC#13 Site does not own /account and carries no VMF mount metadata", async ({ page }) => {
  // A public Site page is passthrough: no `si-mount` meta (that tag is Bouncer's
  // VMF announcement, injected only for mounted apps like Identity/Store).
  await page.goto(`${SITE}/shop`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="si-mount"]')).toHaveCount(0);

  // Site does not serve `/account` — it is Identity's mount, not a Site route.
  // Dev-direct (no Bouncer to forward it) Site returns its 404, proving the
  // Site catch-all does not swallow the Identity mount.
  const res = await page.request.get(`${SITE}/account`, { failOnStatusCode: false });
  expect(res.status()).toBe(404);

  // The `/writing` and `/software` public routes ARE Site's, and render as
  // passthrough HTML (no mount metadata) — the contrast that makes the point.
  await page.goto(`${SITE}/writing`, { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="si-mount"]')).toHaveCount(0);
  await expect(page).toHaveTitle(/somewhatintelligent/i);
});
