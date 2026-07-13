// Destination registry types (PRD FR-11). The registry is destination
// *policy* — auth shape, allowed hosts, endpoints, kill switch — and never
// contains secret values: OAuth client credentials are referenced by env-var
// NAME (`clientIdVar`/`clientSecretVar`) and resolved against VaultEnv at use.
import type { GrantEnv } from "../types";

export type DestKind = "oauth" | "api_key" | "pat";

export interface DestOAuth {
  authorizeUrl: string;
  tokenUrl: string;
  /** VaultEnv key holding the OAuth client id (a var/secret NAME, not a value). */
  clientIdVar: string;
  /** VaultEnv key holding the OAuth client secret. */
  clientSecretVar: string;
  defaultScopes?: readonly string[];
  /** Whether the provider issues refresh tokens (drives refresh + sweep). */
  refreshable: boolean;
}

export interface DestRevoke {
  /** Revoke endpoint; `{client_id}` is substituted for OAuth destinations. */
  url: string;
  /** Defaults to POST. */
  method?: string;
}

export interface Destination {
  id: string;
  kind: DestKind;
  /** Kill switch: false blocks new spends immediately (FR-12). */
  enabled: boolean;
  /** Enforces the live/test discipline of FR-16..19 (Stripe-class). */
  envSensitive: boolean;
  /**
   * Prefix patterns that let put() infer env from the material itself
   * (e.g. Stripe's sk_live_/sk_test_). Checked before requiring a declared env.
   */
  envInferPrefixes?: { live: readonly string[]; test: readonly string[] };
  /** Hosts inject may reach: exact hostnames or "*.suffix" wildcards. https only. */
  allowHosts: readonly string[];
  /** Header(s) stamped onto injected requests; `{token}` is the placeholder. Keys lowercase. */
  headerTemplate: Readonly<Record<string, string>>;
  /**
   * Whether getToken may hand out this destination's material. Defaults OFF
   * for api_key/pat destinations (raw long-lived keys are spent via inject,
   * not handed out — FR-8); OAuth access tokens are short-lived so opting in
   * is reasonable.
   */
  getTokenEnabled: boolean;
  /** Required iff kind === "oauth". */
  oauth?: DestOAuth;
  /** del() revokes upstream when set (FR-3). */
  revoke?: DestRevoke;
  /** Alarm-sweep refresh lead time, seconds. Default 300. */
  refreshLeadSeconds?: number;
}

export type { GrantEnv };
