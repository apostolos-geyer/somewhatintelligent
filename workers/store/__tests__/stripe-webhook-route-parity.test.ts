import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { STORE_STRIPE_WEBHOOK_PATH } from "../src/lib/stripe-webhook";

type BouncerRoute = {
  binding?: string;
  host?: string;
  path?: string;
  mode?: string;
};

type BouncerWrangler = {
  vars?: { ROUTES?: { routes?: BouncerRoute[] } };
  env?: { production?: { vars?: { ROUTES?: { routes?: BouncerRoute[] } } } };
};

// Drift guard: STORE_STRIPE_WEBHOOK_PATH (workers/store/src/lib/stripe-webhook.ts)
// is duplicated as literal route entries in workers/bouncer/wrangler.jsonc
// (staging top-level + env.production apex + env.production www). Per
// CLAUDE.md, per-env routes live directly in each worker's wrangler.jsonc
// (not centralized in @si/config), so this test enforces the parity that
// would otherwise be silently unenforced.
//
// This reaches into a SIBLING worker's file, so it only runs where the whole
// repo is checked out (local `bun run test`, root `vp test run`). The isolated
// CI `test-store` task materializes only workers/store + its deps, so
// bouncer/wrangler.jsonc is absent and the cross-worker assertions skip; the
// self-check below carries no filesystem dependency and always runs.
const bouncerWranglerPath = path.resolve(__dirname, "../../bouncer/wrangler.jsonc");
const bouncerWrangler: BouncerWrangler | null = existsSync(bouncerWranglerPath)
  ? (parseJsonc(readFileSync(bouncerWranglerPath, "utf8")) as BouncerWrangler)
  : null;

// POSITIVE selector (not exclusion-based): matches only STORE-bound,
// passthrough, `/hooks`-prefixed routes for the given host. This stays
// correct even if unrelated STORE passthrough routes (e.g. `/_sfn/store`)
// are added later, and fails loudly (wrong count) rather than silently
// (vacuous `.every()` on an empty array) if the `/hooks` prefix is dropped.
function webhookRoutesFor(routes: BouncerRoute[] | undefined, host: string): BouncerRoute[] {
  return (routes ?? []).filter(
    (r) =>
      r.binding === "STORE" &&
      r.mode === "passthrough" &&
      r.host === host &&
      typeof r.path === "string" &&
      r.path.startsWith("/hooks"),
  );
}

describe.skipIf(!bouncerWrangler)(
  "bouncer webhook route parity with STORE_STRIPE_WEBHOOK_PATH",
  () => {
    test("staging top-level route matches the store constant", () => {
      const matches = webhookRoutesFor(
        bouncerWrangler?.vars?.ROUTES?.routes,
        "staging.somewhatintelligent.ca",
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.path).toBe(STORE_STRIPE_WEBHOOK_PATH);
    });

    test("production apex route matches the store constant", () => {
      const matches = webhookRoutesFor(
        bouncerWrangler?.env?.production?.vars?.ROUTES?.routes,
        "somewhatintelligent.ca",
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.path).toBe(STORE_STRIPE_WEBHOOK_PATH);
    });

    test("production www route matches the store constant", () => {
      const matches = webhookRoutesFor(
        bouncerWrangler?.env?.production?.vars?.ROUTES?.routes,
        "www.somewhatintelligent.ca",
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]?.path).toBe(STORE_STRIPE_WEBHOOK_PATH);
    });
  },
);

// Filesystem-independent, so it runs everywhere (incl. the isolated CI
// test-store task). Proves the comparison logic above isn't vacuously true: a
// route whose path drifted from the TS constant must NOT compare equal.
describe("route-parity self-check", () => {
  test("self-check: a drifted path does not equal STORE_STRIPE_WEBHOOK_PATH", () => {
    const driftedRoutes: BouncerRoute[] = [
      {
        binding: "STORE",
        host: "staging.somewhatintelligent.ca",
        path: "/hooks/store-old",
        mode: "passthrough",
      },
    ];
    const matches = webhookRoutesFor(driftedRoutes, "staging.somewhatintelligent.ca");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.path).not.toBe(STORE_STRIPE_WEBHOOK_PATH);
  });
});
