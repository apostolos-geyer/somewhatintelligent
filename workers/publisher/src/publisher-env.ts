/**
 * Publisher's env shape — explicit, mirroring roadie's `RoadieEnv` convention
 * (a hand-written interface rather than the wrangler-generated global `Env`, so
 * it never collides with a consumer's own `Env` declaration). `import type` on
 * the Roadie entrypoint keeps this in lockstep with the bound worker's RPC
 * surface without pulling roadie into the bundle.
 *
 * `STORE` is the read-only `StoreCatalog` binding (exec-plan 0004 T17) used only
 * to validate a page document's `featuredProductId` at publish time. Publisher
 * stores the foreign product id as an external reference string and never copies
 * product data into the document (INV-DOM-1). The generated Env types this
 * binding as a bare `Service`; the frozen `@si/contracts` interface is asserted
 * here so call sites stay typed against the contract.
 */
import type { Roadie } from "@si/roadie-service";
import type { StoreCatalogEntrypoint } from "@si/contracts";

export interface PublisherEnv {
  DB: D1Database;
  ROADIE: Service<typeof Roadie>;
  STORE: StoreCatalogEntrypoint;
  ENVIRONMENT: string;
}
