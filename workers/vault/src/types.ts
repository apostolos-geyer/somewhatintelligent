// Shared wire types for the vault RPC surface. Nothing in this module ever
// carries decrypted credential material EXCEPT `PutMaterial` (inbound write
// path) and `AccessMaterial` (getToken's scoped return) — both function-scoped
// at every call site, never logged, never stored plaintext.

export type GrantEnv = "live" | "test";
export type GrantKind = "oauth" | "api_key" | "pat";
export type GrantHealth = "ok" | "unhealthy";
export type UnhealthyReason = "revoked_upstream" | "scope_reduced" | "network" | "tampered";

/** Grant address within a tenant. Label optional only where unambiguous (FR-16). */
export type GrantRef = { dest: string; label?: string };

/** Tenant ids and labels are slugs so they can be safely AAD-joined with `|`. */
export const TENANT_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const LABEL_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/** Metadata-only view returned by list(). Never values, never token fragments. */
export interface GrantMeta {
  grantId: string;
  dest: string;
  label: string;
  env: GrantEnv | null;
  kind: GrantKind;
  isDefault: boolean;
  scopes: string[];
  health: GrantHealth;
  unhealthyReason: UnhealthyReason | null;
  createdAt: number;
  lastUsedAt: number | null;
  /** Access-token expiry hint (ms epoch); null for non-expiring material. */
  expiresAt: number | null;
}

/** Inbound credential material for put(). Write-only by construction. */
export type PutMaterial =
  | { kind: "api_key"; apiKey: string }
  | { kind: "pat"; token: string }
  | {
      kind: "oauth";
      accessToken: string;
      refreshToken?: string;
      /** ms epoch access-token expiry, when known. */
      expiresAt?: number;
      scopes?: string[];
    };

export interface PutInput {
  tenantId: string;
  dest: string;
  label: string;
  material: PutMaterial;
  /** Required at put time for env-sensitive destinations unless inferable (FR-1). */
  env?: GrantEnv;
}

export interface SpendSelector {
  tenantId: string;
  dest: string;
  label?: string;
}

/** getToken's return: access material ONLY — never refresh tokens (FR-8). */
export interface AccessMaterial {
  token: string;
  /** ms epoch; null for non-expiring material (api keys, PATs). */
  expiresAt: number | null;
  scopes: string[];
  env: GrantEnv | null;
}

/**
 * inject()'s request shape. Bodies are buffered with a hard cap in v1 —
 * streaming across the two RPC hops (caller → entry → DO) is deferred.
 */
export interface InjectSpec {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: ArrayBuffer | Uint8Array | string;
}

/**
 * inject()'s response: a buffered, structured mirror of the upstream
 * Response. Structured (not a Response instance) so it round-trips two RPC
 * hops without stream-disposal edge cases. `headers["x-vault-grant"]` names
 * the spent grant as `{dest}/{label}` (FR-6).
 */
export interface InjectResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

export interface OAuthBeginInput {
  tenantId: string;
  dest: string;
  label: string;
  /** Consumer-owned callback URL the provider redirects back to. */
  redirectUri: string;
  scopes?: string[];
  env?: GrantEnv;
}

export interface OAuthCallbackInput {
  /** Optional — derived from the state token when omitted (and cross-checked). */
  tenantId?: string;
  code: string;
  state: string;
}

/** Caps for inject()'s buffered bodies (v1; see README). */
export const MAX_INJECT_REQUEST_BODY = 1 * 1024 * 1024; // 1 MiB
export const MAX_INJECT_RESPONSE_BODY = 8 * 1024 * 1024; // 8 MiB
