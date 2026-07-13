// The destination catalog — data, not code paths. New destination = one
// entry here. v1 ships the registry as this code-owned module (changes are
// code review + single-worker reship); the upgrade path to D1 + a KV
// generation counter keeps `getDestination()`'s signature — see README.
import type { Destination } from "./types";

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "stripe",
    kind: "api_key",
    enabled: true,
    envSensitive: true,
    envInferPrefixes: {
      live: ["sk_live_", "rk_live_"],
      test: ["sk_test_", "rk_test_"],
    },
    allowHosts: ["api.stripe.com"],
    headerTemplate: { authorization: "Bearer {token}" },
    getTokenEnabled: false,
  },
  {
    id: "vercel",
    kind: "api_key",
    enabled: true,
    envSensitive: false,
    allowHosts: ["api.vercel.com"],
    headerTemplate: { authorization: "Bearer {token}" },
    getTokenEnabled: false,
  },
  {
    id: "github",
    kind: "oauth",
    enabled: true,
    envSensitive: false,
    allowHosts: ["api.github.com"],
    headerTemplate: {
      authorization: "Bearer {token}",
      "x-github-api-version": "2022-11-28",
    },
    // OAuth access tokens are short-lived material — safe to hand to callers
    // that must own the fetch themselves (FR-8).
    getTokenEnabled: true,
    oauth: {
      authorizeUrl: "https://github.com/login/oauth/authorize",
      tokenUrl: "https://github.com/login/oauth/access_token",
      clientIdVar: "VAULT_GITHUB_CLIENT_ID",
      clientSecretVar: "VAULT_GITHUB_CLIENT_SECRET",
      defaultScopes: ["repo"],
      // GitHub Apps issue expiring user tokens with refresh tokens.
      refreshable: true,
    },
    revoke: {
      // GitHub's grant-revocation endpoint (basic auth with client creds).
      url: "https://api.github.com/applications/{client_id}/grant",
      method: "DELETE",
    },
  },
  {
    // Placeholder kept disabled until onboarded — also exercises the
    // kill-switch path (dest_disabled) with real registry data.
    id: "cloudflare",
    kind: "api_key",
    enabled: false,
    envSensitive: false,
    allowHosts: ["api.cloudflare.com"],
    headerTemplate: { authorization: "Bearer {token}" },
    getTokenEnabled: false,
  },
];
