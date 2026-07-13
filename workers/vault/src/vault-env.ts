// Vault's env shape — explicit rather than the wrangler-generated global
// `Env`, so consumers of `@si/vault-service` don't collide with their own
// generated `Env` (same convention as roadie-env.ts).
import type { VaultTenantDO } from "./do/tenant-do";

export interface VaultEnv {
  VAULT_TENANT: DurableObjectNamespace<VaultTenantDO>;
  ENVIRONMENT: string;
  /** Which VAULT_KEK_V{n} new grants are sealed under. Stringified integer. */
  VAULT_ACTIVE_KEK_VERSION: string;
  // Versioned KEKs (32-byte base64 secrets). V1 is required at runtime; later
  // versions appear during rotation windows. Looked up dynamically by name —
  // see crypto/keys.ts.
  VAULT_KEK_V1?: string;
  VAULT_KEK_V2?: string;
  /** 32-byte base64 HMAC-SHA-256 key signing OAuth state. */
  VAULT_STATE_HMAC?: string;
  // Destination OAuth client credentials, resolved by registry `clientIdVar`/
  // `clientSecretVar` names. Optional until the destination is onboarded.
  VAULT_GITHUB_CLIENT_ID?: string;
  VAULT_GITHUB_CLIENT_SECRET?: string;
  // Ship-time-injected by scripts/deploy-worker.sh (--var flags, not checked
  // into wrangler.jsonc vars); fed to @somewhatintelligent/kit's version
  // module via `overrides`.
  WORKER_VERSION?: string;
  WORKER_COMMIT?: string;
}

// Static props configured in every consumer's service-binding block.
// Carries the calling app's identifier (tamper-resistant; set at deploy time).
export type CtxProps = { callerApp: string };
