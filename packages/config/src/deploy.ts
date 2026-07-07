/**
 * Deployment-related constants that CODE consumers read (build, runtime, and
 * test): the worker-name prefix, the apex/dev domains, and the Cloudflare
 * account id. None are secret.
 *
 * The `wrangler.jsonc` files are standalone, checked-in source (top level =
 * staging, `env.production` = production). Per-env resource ids (D1 UUIDs,
 * Vectorize/queue names, RTK app ids, workers.dev subdomain) live directly in
 * each worker's `wrangler.jsonc`, not here. Only the fields with a live code
 * import remain.
 */
export const platformDeployConfig = {
  /** Production apex / base domain. E.g. "acme.com" or "platform.example". */
  baseDomain: "somewhatintelligent.ca",

  /**
   * Local dev base domain — must be a TLD portless recognizes. The default
   * `.localhost` TLD resolves to 127.0.0.1 automatically.
   */
  devDomain: "somewhatintelligent.localhost",

  /**
   * Per-fork prefix for Cloudflare worker names + cross-worker service
   * bindings, queues, and analytics datasets. Keeps this fork's resources from
   * colliding with other forks on the same CF account. Workers deploy as
   * `<workerPrefix>-<service>-<env>` (e.g. `si-guestlist-staging`). Read by
   * `packages/secrets`' manifest, `scripts/provision-realtimekit.ts`, and the
   * bouncer/guestlist vitest configs (to name the miniflare stub workers that
   * back their `services` bindings).
   */
  workerPrefix: "si",

  /**
   * Cloudflare account ID; change if this fork deploys elsewhere. Read by
   * `scripts/provision-realtimekit.ts` (falls back to it when
   * `CLOUDFLARE_ACCOUNT_ID` is unset); it is also the literal `account_id`
   * baked into every worker's `wrangler.jsonc`.
   */
  cloudflareAccountId: "c735c5a53d864bee37400befb7f4c7f4",
} as const;

export type PlatformDeployConfig = typeof platformDeployConfig;
