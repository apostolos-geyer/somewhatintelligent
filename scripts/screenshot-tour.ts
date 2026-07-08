#!/usr/bin/env bun
/**
 * Repeatable design-review screenshot tour of every page across identity +
 * store, at full desktop resolution in the dark theme. Boots against an
 * already-running local dev stack (`bun run dev`) — does not start one.
 *
 * Usage:
 *   bun run dev                          # in another shell, and `bun run seed` once
 *   bun scripts/screenshot-tour.ts [outDir]
 *
 * Output: one PNG per page/state, saved to docs/design/redesign-proof/ by
 * default (the one path `*.png` is un-ignored for, so results can be
 * committed as design-review evidence — see .gitignore).
 */
import { chromium, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const IDENTITY = "https://identity.somewhatintelligent.localhost";
const STORE = "https://store.somewhatintelligent.localhost";
const ADMIN_EMAIL = "super@user.com";
const ADMIN_PASSWORD = "superuserdo";

const outDir = process.argv[2] ?? "docs/design/redesign-proof";

async function shot(page: Page, name: string) {
  // Let route transitions / dialog animations settle before capturing.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${outDir}/tour-${name}.png`, fullPage: true });
  console.log(`  ✓ ${name}`);
}

async function signIn(page: Page) {
  await page.goto(`${IDENTITY}/sign-in`);
  // Wait for React to hydrate before interacting — clicking before hydration
  // lets the form fall through to a native submit (a real POST to the auth
  // API, rendering raw JSON) instead of the client-side handler. The dev
  // server keeps HMR/analytics connections open, so `networkidle` never
  // resolves — wait on a concrete element + a settle delay instead.
  await page.getByLabel("Email", { exact: true }).waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  // Playwright's `fill` bypasses TanStack Form's keystroke-driven field state
  // (same trap documented for agent-browser in the interactive-test skill) —
  // click + keyboard.type + blur instead.
  await page.getByLabel("Email", { exact: true }).click();
  await page.keyboard.type(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).click();
  await page.keyboard.type(ADMIN_PASSWORD);
  await page.keyboard.press("Tab"); // blur — TanStack Form validates onBlur
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await page.waitForURL(`${IDENTITY}/account`, { timeout: 15_000 });
}

async function maybeClickAndShot(
  page: Page,
  selector: string,
  name: string,
  opts: { sheet?: boolean } = {},
) {
  const link = page.locator(selector).first();
  if ((await link.count()) === 0) {
    console.log(`  — skipped ${name} (no rows in seed data)`);
    return;
  }
  await link.click();
  if (opts.sheet) {
    // Identity's detail routes render inside a Sheet whose content depends
    // on its own loader — wait for the panel itself, not just a fixed
    // delay, so the screenshot isn't taken mid-transition/mid-fetch.
    await page.locator('[data-slot="sheet-content"]').first().waitFor({ state: "visible" });
  }
  await shot(page, name);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: "dark",
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [console error]", msg.text());
  });
  page.on("pageerror", (err) => console.log("  [page error]", err.message));

  console.log("Unauthenticated pages…");
  await page.goto(`${IDENTITY}/sign-in`);
  await shot(page, "identity-sign-in");
  await page.goto(STORE);
  await shot(page, "store-home-anon");

  console.log("Signing in as platform admin…");
  await signIn(page);

  console.log("Identity — account…");
  await shot(page, "identity-account");
  for (const sub of ["sessions", "passkeys", "api-keys", "providers"]) {
    await page.goto(`${IDENTITY}/account/${sub}`);
    await shot(page, `identity-account-${sub}`);
  }

  console.log("Identity — admin…");
  await page.goto(`${IDENTITY}/admin`);
  await shot(page, "identity-admin");

  await page.goto(`${IDENTITY}/admin/users`);
  await shot(page, "identity-admin-users");

  await page.goto(`${IDENTITY}/admin/sessions`);
  await shot(page, "identity-admin-sessions");

  await page.goto(`${IDENTITY}/admin/api-keys`);
  await shot(page, "identity-admin-api-keys");

  await page.goto(`${IDENTITY}/admin/clients`);
  await shot(page, "identity-admin-clients");
  await page.goto(`${IDENTITY}/admin/clients/new`);
  await shot(page, "identity-admin-clients-new");
  await page.goto(`${IDENTITY}/admin/clients`);
  await maybeClickAndShot(
    page,
    'table a[href^="/admin/clients/"]',
    "identity-admin-clients-detail",
    {
      sheet: true,
    },
  );

  await page.goto(`${IDENTITY}/admin/orgs`);
  await shot(page, "identity-admin-orgs");
  await page.goto(`${IDENTITY}/admin/orgs/new`);
  await shot(page, "identity-admin-orgs-new");
  await page.goto(`${IDENTITY}/admin/orgs`);
  await maybeClickAndShot(page, 'table a[href^="/admin/orgs/"]', "identity-admin-orgs-detail", {
    sheet: true,
  });

  console.log("Store — storefront (authed)…");
  await page.goto(STORE);
  await shot(page, "store-home");
  await maybeClickAndShot(page, 'a[href^="/products/"]', "store-product-detail");

  await page.goto(`${STORE}/cart`);
  await shot(page, "store-cart");

  await page.goto(`${STORE}/orders`);
  await shot(page, "store-orders");

  console.log("Store — admin…");
  await page.goto(`${STORE}/admin`);
  await shot(page, "store-admin");

  await page.goto(`${STORE}/admin/products`);
  await shot(page, "store-admin-products");
  await maybeClickAndShot(page, 'a[href^="/admin/products/"]', "store-admin-product-detail");

  await page.goto(`${STORE}/admin/orders`);
  await shot(page, "store-admin-orders");
  await maybeClickAndShot(page, 'a[href^="/admin/orders/"]', "store-admin-order-detail");

  await browser.close();
  console.log(`\nDone. Screenshots in ${outDir}/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
