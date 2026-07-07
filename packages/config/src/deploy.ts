/**
 * Deployment-related constants that CODE consumers read (build, runtime, and
 * test): the worker-name prefix, the apex/dev domains, and the Cloudflare
 * account id. None are secret.
 *
 * The `wrangler.jsonc` files are now standalone, checked-in source (top level =
 * staging, `env.production` = production) — they are no longer rendered from
 * this file. Per-env resource ids (D1 UUIDs, Vectorize/queue names, RTK app
 * ids, workers.dev subdomain) therefore live directly in each worker's
 * `wrangler.jsonc`, not here. Only the fields with a live code import remain.
 */
export const platformDeployConfig = {
  /** Production apex / base domain. E.g. "acme.com" or "platform.example". */
  baseDomain: "sproutportal.ca",

  /**
   * Local dev base domain — must be a TLD portless recognizes. The default
   * `.localhost` TLD resolves to 127.0.0.1 automatically.
   */
  devDomain: "sproutportal.localhost",

  /**
   * Per-fork prefix for Cloudflare worker names + cross-worker service
   * bindings, queues, and analytics datasets. Keeps this fork's resources from
   * colliding with other forks on the same CF account. Workers deploy as
   * `<workerPrefix>-<service>-<env>` (e.g. `sprout-guestlist-staging`). Read by
   * `packages/secrets`' manifest, `scripts/provision-realtimekit.ts`, and the
   * bouncer/guestlist vitest configs (to name the miniflare stub workers that
   * back their `services` bindings).
   */
  workerPrefix: "sprout",

  /**
   * Cloudflare account ID (the Sprout account, `Sproutcannabis@gmail.com`);
   * change if this fork deploys elsewhere. Read by
   * `scripts/provision-realtimekit.ts` (falls back to it when
   * `CLOUDFLARE_ACCOUNT_ID` is unset); it is also the literal `account_id`
   * baked into every worker's `wrangler.jsonc`.
   */
  cloudflareAccountId: "30ce6004cd9c2907f0b06fe401c4f4ba",
} as const;

export type PlatformDeployConfig = typeof platformDeployConfig;
