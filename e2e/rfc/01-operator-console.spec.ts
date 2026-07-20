import { expect, test } from "@playwright/test";
import { OPERATOR } from "./helpers";

/**
 * RFC-0001 browser test #1 — open Operator as the development operator.
 *
 * Dev-direct, Operator resolves DEV_OPERATOR automatically (no Access): the
 * Overview renders the resolved actor and the eight-module nav, proving the
 * Access → shell → page pipeline end to end.
 */
test("RFC#1 Operator opens for the development operator", async ({ page }) => {
  await page.goto(OPERATOR, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  // The resolved dev actor is echoed on the overview + topbar.
  await expect(page.getByText(/operator@somewhatintelligent\.localhost/i).first()).toBeVisible();

  // The built modules are reachable from the sidebar nav.
  for (const label of ["Objects", "Texts", "Software", "Pages", "Orders", "Media", "Settings"]) {
    await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});
