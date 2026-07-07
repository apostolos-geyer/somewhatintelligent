#!/usr/bin/env bun
/**
 * Provision the browser engine for the repo's on-demand browser tooling — same
 * behaviour on a laptop or in an ephemeral cloud/CI container:
 *
 *   • Playwright Chromium → drives `bun run test:e2e` AND `agent-browser`
 *     (agent-browser attaches to it over CDP — see docs/browser-automation.md;
 *     it does not download its own browser).
 *
 * On Linux it also installs the shared OS libraries the browser needs (via
 * Playwright's `--with-deps`). The installer is idempotent. Browser location is
 * left to Playwright (honors PLAYWRIGHT_BROWSERS_PATH).
 *
 *   bun run browsers:install                 # install (foreground)
 *   bun scripts/setup-browsers.ts --ensure   # SessionStart-hook guard:
 *       present → no-op; missing in a cloud container (Linux+root, or
 *       GREENROOM_PROVISION_BROWSERS=1) → provision in the background; missing
 *       locally → print how to install. Never blocks, always exits 0.
 */
import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { join } from "node:path";

const isLinux = process.platform === "linux";
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const pwArgs = isLinux
  ? ["playwright", "install", "--with-deps", "chromium"]
  : ["playwright", "install", "chromium"];

async function installed(): Promise<boolean> {
  try {
    const { chromium } = await import("playwright-core");
    return existsSync(chromium.executablePath());
  } catch {
    // playwright-core or its Chromium not resolvable yet
    return false;
  }
}

function bunx(argv: string[], fd?: number): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("bunx", argv, {
      stdio: fd ? ["ignore", fd, fd] : "inherit",
      env: process.env,
    });
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(1));
  });
}

// ── --ensure: the SessionStart hook entry point ──────────────────────────────
if (process.argv.includes("--ensure")) {
  if (await installed()) {
    console.log("[browsers] present — ok.");
    process.exit(0);
  }
  const auto = process.env.GREENROOM_PROVISION_BROWSERS === "1" || (isLinux && isRoot);
  if (process.env.GREENROOM_PROVISION_BROWSERS === "0" || !auto) {
    console.log("[browsers] not installed — run `bun run browsers:install` when you need them.");
    process.exit(0);
  }
  // Provision in the background so session start never blocks or hits the hook
  // timeout. Re-runs this script with no args (the foreground path below).
  const log = join(process.cwd(), ".browser-provision.log");
  const fd = openSync(log, "a");
  const child = spawn(process.execPath, [import.meta.path], {
    detached: true,
    stdio: ["ignore", fd, fd],
    env: process.env,
  });
  child.unref();
  console.log(
    `[browsers] provisioning in background → tail ${log} (or run \`bun run browsers:install\` to block).`,
  );
  process.exit(0);
}

// ── foreground install ───────────────────────────────────────────────────────
console.log(
  `→ installing Playwright Chromium (platform=${process.platform} arch=${process.arch} root=${isRoot})`,
);
const code = await bunx(pwArgs);
if (code) {
  console.error("✗ provisioning failed (see output above).");
  process.exit(code);
}
console.log(
  "✓ ready — `bun run test:e2e` (Playwright) · `agent-browser --cdp <port>` drives this Chromium (see docs/browser-automation.md)",
);
