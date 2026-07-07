import { defineConfig, devices } from "@playwright/test";

// Local declaration so this root config typechecks without pulling node types
// into scope; `process` is the real Node global at runtime (Playwright loads this
// config in Node).
declare const process: { env: Record<string, string | undefined> };

/**
 * Minimal Playwright config so `bun run test:e2e` works on demand. Specs live in
 * `e2e/` (kept out of vitest's `*.test.ts` world). Not wired into CI — agents /
 * humans run it when needed. The browser is whatever Playwright resolves via its
 * own registry (honors PLAYWRIGHT_BROWSERS_PATH); nothing is hardcoded.
 * Write specs with absolute URLs as the app surface grows — no shared baseURL.
 *
 * `PLAYWRIGHT_CHROMIUM_PATH` optionally pins a specific Chrome/Chromium binary —
 * useful in a container where a provisioned build's revision doesn't match the
 * playwright-core registry (and the Playwright CDN isn't reachable to fetch the
 * matching one). Unset → Playwright resolves its own browser as normal.
 */
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // portless serves the brand subdomains over a local self-signed CA.
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
});
