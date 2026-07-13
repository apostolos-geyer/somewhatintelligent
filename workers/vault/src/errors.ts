// Machine-readable error codes — the entire wire error contract. Messages
// are prompt-grade and NEVER carry secret material; codes are what consumers
// switch on. See PRD §6 (error contract) and §10 (threat model).
export type VaultErrorCode =
  | "dest_unknown" // destination id not in the registry
  | "dest_disabled" // registry kill switch (enabled: false)
  | "host_not_allowed" // inject target host outside the destination allowlist
  | "grant_missing" // no grant under (dest, label); `labels` lists what exists
  | "grant_ambiguous" // label omitted, >1 grant, no default; `labels` lists them
  | "live_requires_explicit_label" // implicit selection would reach a live grant (FR-17)
  | "grant_unhealthy" // selected grant is unhealthy; message carries the reason
  | "refresh_failed" // upstream token refresh failed (transient or permanent)
  | "upstream_unreachable" // inject's forwarded fetch failed at the network layer
  | "material_mismatch" // put material kind doesn't match the destination kind
  | "state_invalid" // OAuth state failed HMAC / TTL / single-use / binding checks
  | "oauth_exchange_failed" // authorization-code exchange rejected upstream
  | "oauth_not_supported" // oauthBegin on a non-OAuth destination
  | "get_token_disabled" // getToken on an api_key/pat dest without registry opt-in (FR-8)
  | "env_required" // env-sensitive dest, env neither declared nor inferable (FR-1)
  | "env_mismatch" // declared env contradicts what the material infers (FR-1)
  | "env_immutable" // re-put attempted to change a grant's env (FR-19)
  | "confirm_live_required" // setDefault onto a live grant without confirmLive (FR-17)
  | "label_invalid" // label is not a 1-32 char slug
  | "tenant_invalid" // tenant id fails the slug check
  | "body_too_large" // inject request/response body exceeded the buffered cap
  | "internal_error"; // unexpected exception (injected by @instrumented onError)
