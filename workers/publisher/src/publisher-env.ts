/**
 * Publisher's env shape — explicit, mirroring roadie's `RoadieEnv` convention
 * (a hand-written interface rather than the wrangler-generated global `Env`, so
 * it never collides with a consumer's own `Env` declaration). `import type` on
 * the Roadie entrypoint keeps this in lockstep with the bound worker's RPC
 * surface without pulling roadie into the bundle.
 *
 * SCAFFOLD (exec-plan 0004 track T14). Later tracks add:
 * - `STORE: Service<StoreCatalogEntrypoint>` for page-reference validation (T17).
 */
import type { Roadie } from "@si/roadie-service";

export interface PublisherEnv {
  DB: D1Database;
  ROADIE: Service<typeof Roadie>;
  ENVIRONMENT: string;
}
