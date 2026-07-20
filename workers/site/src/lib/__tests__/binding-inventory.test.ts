import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import { describe, expect, test } from "vitest";

// INV-SITE-1 (RFC-0001 cross-cutting rule 5): lock Site's binding inventory by
// parsing the CHECKED-IN wrangler.jsonc (source, not generated). Site is the
// public Astro SSR presentation surface, bound by Bouncer at the apex root — it
// is never directly addressed, so it declares NO routes / custom domains. Its
// only domain reach is the read-only StoreCatalog / PublisherPublic service
// bindings; no D1/R2/queue/KV/DO/AE/admin binding may ever appear. Reads the
// real file relative to the worker dir so any config drift fails this suite.

type ServiceBinding = { binding?: string; service?: string; entrypoint?: string };
type WranglerEnv = {
  services?: ServiceBinding[];
  routes?: unknown[];
};
type Wrangler = WranglerEnv & { env?: { production?: WranglerEnv } };

const wranglerPath = path.resolve(__dirname, "../../../wrangler.jsonc");
const wrangler = parseJsonc(readFileSync(wranglerPath, "utf8")) as Wrangler;

// The `assets` binding (ASSETS) is intentionally present — it is not a
// stateful/admin binding, so it is not policed here. Everything below IS.
const FORBIDDEN_KEYS = [
  "d1_databases",
  "r2_buckets",
  "queues",
  "analytics_engine_datasets",
  "kv_namespaces",
  "durable_objects",
  "migrations",
  "vectorize",
  "hyperdrive",
  "mtls_certificates",
  "dispatch_namespaces",
  "workflows",
  "ai",
  "browser",
  "send_email",
] as const;

// [label, env config, service-name suffix]
const ENVS: Array<[string, WranglerEnv, string]> = [
  ["staging (top level)", wrangler, "staging"],
  ["env.production", wrangler.env?.production ?? {}, "production"],
];

describe("Site binding inventory (INV-SITE-1)", () => {
  test.each(ENVS)(
    "%s: service bindings are exactly STORE->StoreCatalog and PUBLISHER->PublisherPublic",
    (_label, cfg, suffix) => {
      const services = cfg.services ?? [];
      expect(services).toHaveLength(2);
      const byBinding = Object.fromEntries(services.map((s) => [s.binding, s]));
      expect(Object.keys(byBinding).sort()).toEqual(["PUBLISHER", "STORE"]);

      expect(byBinding.STORE).toMatchObject({
        service: `si-store-${suffix}`,
        entrypoint: "StoreCatalog",
      });
      expect(byBinding.PUBLISHER).toMatchObject({
        service: `si-publisher-${suffix}`,
        entrypoint: "PublisherPublic",
      });
    },
  );

  test.each(ENVS)("%s: declares no D1/R2/queue/KV/DO/AE/migration binding", (_label, cfg) => {
    const raw = cfg as Record<string, unknown>;
    for (const key of FORBIDDEN_KEYS) {
      const value = raw[key];
      if (Array.isArray(value)) {
        expect(value, `${key} must be empty`).toEqual([]);
      } else {
        expect(value, `${key} must be absent`).toBeUndefined();
      }
    }
  });

  test.each(ENVS)("%s: no admin binding (no Guestlist/Roadie/Stripe)", (_label, cfg) => {
    for (const s of cfg.services ?? []) {
      expect(s.binding ?? "").not.toMatch(/guestlist|roadie|stripe|operator/i);
      expect(s.service ?? "").not.toMatch(/guestlist|roadie|stripe/i);
      expect(s.entrypoint ?? "").not.toMatch(/guestlist|roadie|stripe|operator/i);
    }
  });

  test.each(ENVS)("%s: declares no routes / custom domains (bouncer fronts it)", (_label, cfg) => {
    expect(cfg.routes ?? []).toEqual([]);
  });
});

// Complements the Operator suite's desk.* assertion: Site never claims the
// desk console host, in any env, at the raw-config level.
test("no desk.* host appears anywhere in Site's wrangler.jsonc", () => {
  expect(readFileSync(wranglerPath, "utf8")).not.toMatch(/desk\./);
});
