import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the sprout browser journeys. Hosts follow the pinned
 * dev-direct topology (06b): brand portals are `<slug>.sprout.sproutportal.localhost`,
 * the Hub apex is `sprout.sproutportal.localhost`, sign-in is on identity.
 */
export const HOSTS = {
  identity: "https://identity.sproutportal.localhost",
  hub: "https://sprout.sproutportal.localhost",
  brand: (slug: string) => `https://${slug}.sprout.sproutportal.localhost`,
} as const;

/** Seeded demo credentials (workers/guestlist bootstrap). */
export const USERS = {
  aliceAdmin: { email: "alice@example.com", password: "alicepwd123" },
  bobBudtender: { email: "bob@example.com", password: "bobpwd1234" },
  daveBeta: { email: "dave@example.com", password: "davepwd123" },
  superAdmin: { email: "super@user.com", password: "superuserdo" },
} as const;

/**
 * Type into a field with REAL keystrokes. These forms (TanStack Form) only update
 * their controlled state on genuine key events — `.fill()` sets the value without
 * firing the onChange they track, leaving submit buttons disabled. `click()` +
 * `pressSequentially()` mirrors a human and is what actually drives the state.
 */
export async function typeInto(page: Page, locator: ReturnType<Page["getByRole"]>, text: string) {
  // fill() sets the React-tracked value (onChange fires); blur() then runs the
  // form's onBlur validation so canSubmit flips and the value is committed. A
  // never-blurred field leaves the form pristine ("was '' / non-empty" errors).
  await locator.fill(text);
  await locator.blur();
}

/**
 * Sign in via the identity UI. The session cookie's Domain=.sproutportal.localhost
 * means the resulting state carries across every brand subdomain AND the apex Hub,
 * so callers can navigate straight to a brand host afterwards.
 */
export async function signIn(page: Page, user: { email: string; password: string }): Promise<void> {
  await page.goto(`${HOSTS.identity}/sign-in`);
  const submit = page.getByRole("button", { name: "Sign In", exact: true });
  await typeInto(page, page.getByRole("textbox", { name: "Email" }), user.email);
  await typeInto(page, page.getByRole("textbox", { name: "Password" }), user.password);
  await expect(submit).toBeEnabled({ timeout: 5000 });
  // Drive submit AND capture the auth response in one step — deterministic
  // regardless of whether the form client-redirects or does a native POST. The
  // 200 sets the session cookie (Domain=.sproutportal.localhost), which carries
  // to every brand host + the Hub.
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/auth/sign-in/email") && r.request().method() === "POST",
      { timeout: 15000 },
    ),
    submit.click(),
  ]);
  expect(resp.ok(), "sign-in should return 200").toBeTruthy();
}

/**
 * Click "Enter Portal" and wait for the section grid to reveal. Retries the click
 * so a click that lands a hair before hydration (a no-op) is re-issued — the
 * one-page shell reveals the grid via client state, not a navigation.
 */
export async function enterPortal(page: Page): Promise<void> {
  const enter = page.getByRole("button", { name: "Enter Portal" });
  await expect(async () => {
    if (await enter.isVisible().catch(() => false)) await enter.click({ timeout: 2000 });
    await expect(page.getByRole("heading", { name: "Store Assets", exact: true })).toBeVisible({
      timeout: 2000,
    });
  }).toPass({ timeout: 20000 });
}

/**
 * Read the brand's injected primary from the SSR <style> (BrandStyle). The runtime
 * theme overrides the `--color-sprout` token (the Primary; `--color-primary` is a
 * compiled @theme alias that only lives in the external CSS, not the inline SSR
 * style — so grep the var that's actually injected per-host).
 */
export async function readPrimaryColor(page: Page): Promise<string> {
  const html = await page.content();
  const m = html.match(/--color-sprout:\s*(#[0-9a-fA-F]+)/);
  expect(m, "brand primary color should be injected").not.toBeNull();
  return m![1]!.toLowerCase();
}
