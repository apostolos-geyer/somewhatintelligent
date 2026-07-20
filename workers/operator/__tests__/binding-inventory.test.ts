import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseJsonc } from "jsonc-parser";

// INV-OP-2 (RFC-0001 cross-cutting rule 5): lock Operator's binding inventory
// by parsing the CHECKED-IN wrangler.jsonc (source, not generated). Operator is
// the Access-fronted console on desk.*; the ONLY domain state it can reach is
// the StoreOperator / PublisherOperator service bindings. No D1/R2/queue/KV/DO/
// AE, no Guestlist/Roadie/Stripe binding, and no workers.dev / preview_urls
// bypass hostname (D6). Reads the real file relative to the worker dir so any
// config drift fails this suite rather than passing against a fixture copy.

type ServiceBinding = {
  binding?: string;
  service?: string;
  entrypoint?: string;
  props?: Record<string, unknown>;
};
type Route = { pattern?: string; custom_domain?: boolean };
type WranglerEnv = {
  workers_dev?: boolean;
  preview_urls?: boolean;
  services?: ServiceBinding[];
  routes?: Route[];
};
type Wrangler = WranglerEnv & { env?: { production?: WranglerEnv } };

const wranglerPath = path.resolve(__dirname, "../wrangler.jsonc");
const wrangler = parseJsonc(readFileSync(wranglerPath, "utf8")) as Wrangler;

// Binding categories that must NEVER appear on Operator (any env). Present-but-
// empty is tolerated (a lingering `[]`); a populated array or object fails.
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

// [label, env config, service-name suffix, expected desk host]
const ENVS: Array<[string, WranglerEnv, string, string]> = [
  ["staging (top level)", wrangler, "staging", "desk.staging.somewhatintelligent.ca"],
  ["env.production", wrangler.env?.production ?? {}, "production", "desk.somewhatintelligent.ca"],
];

describe("Operator binding inventory (INV-OP-2)", () => {
  test.each(ENVS)(
    "%s: service bindings are exactly the Store + Publisher operator entrypoints",
    (_label, cfg, suffix) => {
      const services = cfg.services ?? [];
      expect(services).toHaveLength(2);
      const byBinding = Object.fromEntries(services.map((s) => [s.binding, s]));
      expect(Object.keys(byBinding).sort()).toEqual(["PUBLISHER", "STORE"]);

      expect(byBinding.STORE).toMatchObject({
        service: `si-store-${suffix}`,
        entrypoint: "StoreOperator",
      });
      expect(byBinding.STORE?.props).toEqual({ callerApp: "operator" });

      expect(byBinding.PUBLISHER).toMatchObject({
        service: `si-publisher-${suffix}`,
        entrypoint: "PublisherOperator",
      });
      expect(byBinding.PUBLISHER?.props).toEqual({ callerApp: "operator" });
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

  test.each(ENVS)("%s: no Guestlist/Roadie/Stripe binding", (_label, cfg) => {
    for (const s of cfg.services ?? []) {
      expect(s.binding ?? "").not.toMatch(/guestlist|roadie|stripe/i);
      expect(s.service ?? "").not.toMatch(/guestlist|roadie|stripe/i);
      expect(s.entrypoint ?? "").not.toMatch(/guestlist|roadie|stripe/i);
    }
  });

  test.each(ENVS)("%s: workers_dev and preview_urls are both false (D6)", (_label, cfg) => {
    expect(cfg.workers_dev).toBe(false);
    expect(cfg.preview_urls).toBe(false);
  });

  test.each(ENVS)(
    "%s: declares the desk.* custom-domain route",
    (_label, cfg, _suffix, deskHost) => {
      const routes = cfg.routes ?? [];
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({ pattern: deskHost, custom_domain: true });
    },
  );
});
