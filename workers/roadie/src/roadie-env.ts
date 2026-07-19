// Roadie's env shape — explicit rather than the wrangler-generated global
// `Env`. Consumers of `@si/roadie-service` obtain Roadie's RPC types via
// `wrangler types -c ./wrangler.jsonc -c ../../workers/roadie/wrangler.jsonc`
// (per RFC §6 — Consumer type integration). Using the global `Env` here would
// collide with the consumer's own `Env` declaration from their wrangler types.

export interface RoadieEnv {
  DB: D1Database;
  BLOBS: R2Bucket;
  ENVIRONMENT: string;
  R2_BUCKET: string;
  R2_ACCOUNT_ID: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  // Dev-only: browser-reachable origin of roadie's `/__dev/blob/<id>` route,
  // seeded into `.dev.vars` (absent in staging/production). `getReadUrl`
  // points local read URLs here; falls back to `http://127.0.0.1:8790`.
  ROADIE_DEV_ORIGIN?: string;
  // Ship-time-injected by scripts/deploy-worker.sh / generate-preview-tasks.sh
  // (--var flags, not checked into wrangler.jsonc vars); fed to
  // @somewhatintelligent/kit's version module via `overrides`, since that
  // module no longer reads deploy vars off env itself.
  WORKER_VERSION?: string;
  WORKER_COMMIT?: string;
}

// Static props configured in every consumer's service-binding block.
// Carries the calling app's identifier (tamper-resistant; set at deploy time).
// See spec §API Contract — Caller identity and RFC ADR-RD-011.
export type CtxProps = { callerApp: string };
