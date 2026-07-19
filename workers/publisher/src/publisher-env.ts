/**
 * Publisher's env shape — explicit, mirroring roadie's `RoadieEnv` convention
 * (a hand-written interface rather than the wrangler-generated global `Env`, so
 * it never collides with a consumer's own `Env` declaration).
 *
 * SCAFFOLD (exec-plan 0004 track T14). Later tracks add:
 * - `STORE: Service<StoreCatalogEntrypoint>` for page-reference validation (T17);
 * - the private `MediaStorage` adapter wiring (T5).
 */
export interface PublisherEnv {
  DB: D1Database;
  ENVIRONMENT: string;
}
