// Roadie's env shape — explicit rather than the wrangler-generated global
// `Env`. Consumers of `@greenroom/roadie-service` obtain Roadie's RPC types via
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
}

// Static props configured in every consumer's service-binding block.
// Carries the calling app's identifier (tamper-resistant; set at deploy time).
// See spec §API Contract — Caller identity and RFC ADR-RD-011.
export type CtxProps = { callerApp: string };
