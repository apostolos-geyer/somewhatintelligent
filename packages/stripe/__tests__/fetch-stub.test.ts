import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { prices, products } from "../src/config";

// Exercises the REAL offline path in scripts/fetch.ts as a subprocess (not a
// unit-level import) so this test proves the thing CI/a fresh clone actually
// runs (`bun run fetch` / `bun run typecheck`) — never the live Stripe API.
// STRIPE_SECRET_KEY is explicitly stripped from the child's env regardless of
// what the runner's own environment carries.
const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED_PATH = resolve(PKG_DIR, "src/generated.ts");

function runFetchOffline() {
  const env = { ...process.env };
  delete env.STRIPE_SECRET_KEY;
  return spawnSync("bun", ["run", "scripts/fetch.ts"], {
    cwd: PKG_DIR,
    env,
    encoding: "utf8",
  });
}

describe("fetch.ts offline stub (no STRIPE_SECRET_KEY)", () => {
  // Regenerate the real generated.ts back to a stub afterward so this test
  // never leaves the working tree pointed at a stale/live-mode artifact —
  // the file is gitignored build output either way.
  afterEach(() => {
    runFetchOffline();
  });

  test("exits 0 and writes an empty-string stub with the correct shape", () => {
    const result = runFetchOffline();

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const generated = readFileSync(GENERATED_PATH, "utf8");
    expect(generated).toContain("AUTO-GENERATED STUB (offline mode)");

    // Every configured product/price key gets an empty-string stub id — that
    // is what lets @si/stripe (and its consumers, e.g. workers/guestlist)
    // typecheck with zero secrets.
    for (const key of Object.keys(products)) {
      expect(generated).toMatch(new RegExp(`\\b${key}: "" as const`));
    }
    for (const key of Object.keys(prices)) {
      expect(generated).toMatch(new RegExp(`\\b${key}: "" as const`));
    }

    expect(generated).toContain("export type StripeProductId");
    expect(generated).toContain("export type StripePriceId");
  });

  test("never touches the network — no live/test key is read from the child env", () => {
    const result = runFetchOffline();
    expect(result.stdout).toContain("STRIPE_SECRET_KEY not set");
    expect(result.stdout).not.toMatch(/Fetching Stripe configuration/);
  });
});
