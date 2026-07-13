# vault

Multi-tenant encrypted key store: stores third-party credentials (OAuth
grants, API keys, PATs) per tenant, encrypted at rest, and spends them on the
tenant's behalf via transparent header injection. The keystone under an MCP
gateway, connector catalog, or agent runtime — but it ships and tests alone.

**Binding-only.** Consumers reach vault exclusively over a service binding to
the `Vault` entrypoint (`Service<typeof Vault>`); there is no HTTP API. Vault
trusts the `tenantId` its callers pass — same-account service bindings are
the auth boundary, callers verify their own users. `props.callerApp` on the
binding (plus the `meta.callerApp` dev fallback) attributes every audit event.

```jsonc
// consumer wrangler.jsonc
"services": [{ "binding": "VAULT", "service": "si-vault-staging",
               "entrypoint": "Vault", "props": { "callerApp": "gateway" } }]
```

```ts
import { createVaultClient } from "@si/vault-service/client";
const vault = createVaultClient(env.VAULT, { callerApp: "gateway", getRequestId, getActor });

await vault.put({
  tenantId,
  dest: "stripe",
  label: "sandbox",
  material: { kind: "api_key", apiKey: "sk_test_..." },
});
const res = await vault.inject({
  tenantId,
  dest: "stripe",
  label: "sandbox",
  request: { url: "https://api.stripe.com/v1/charges", method: "POST", body },
});
```

## Shape

- **entry worker** (`src/index.ts`, `src/methods/*`): shape validation and
  tenant→DO routing only. No crypto, no token material.
- **tenant DO** (`src/do/*`, `VaultTenantDO`): one Durable Object — and one
  private SQLite database — per tenant. ALL crypto, grant storage,
  single-flight refresh, OAuth state, the alarm sweep, and the recent-audit
  window live here. There is no cross-tenant table anywhere.
- **registry** (`src/registry/`): destination policy as data — hosts
  allowlist, header template, OAuth endpoints, env-sensitivity, kill switch.
  New destination = one entry in `destinations.ts`.

Grant addressing is `(dest, label)` with tenant-chosen labels (`live`,
`sandbox`, …). Selection rails: label may be omitted only when unambiguous
(single grant or explicit default); live grants on env-sensitive destinations
are never selected implicitly (`setDefault` onto live requires
`confirmLive: true`); there is NO cross-label fallback; env is immutable per
grant and cryptographically bound (below).

## Crypto

Envelope encryption, WebCrypto only:

- Per-grant 32-byte DEK → AES-256-GCM over one canonical-JSON payload blob.
- DEK wrapped via AES-KW under a versioned KEK (`VAULT_KEK_V1`, `V2`, …;
  32-byte base64 secret bindings; active seal version in
  `VAULT_ACTIVE_KEK_VERSION`). KEKs import once per isolate, non-extractable.
- AAD binds `tenant|dest|label|env|grantId|kekVersion`: ciphertext moved to
  any other row, tenant, label, environment, or key epoch fails
  authentication. A sandbox ciphertext physically cannot be presented as a
  live grant.
- OAuth state: HMAC-SHA-256 (`VAULT_STATE_HMAC`), single-use nonce row,
  10-minute TTL, bound to (tenant, dest, label, env).

**Deviation from the PRD (§7)**: the PRD wants AAD to bind `kekVersion` AND
rotation to leave payload ciphertext untouched. Those are mutually exclusive
under GCM — decryption needs the exact sealing AAD. We keep the full AAD
binding and **re-seal the payload** (same DEK, fresh IV, new-epoch AAD)
during rotation; the blob is <1 KB, so the extra GCM op is noise.

`rotateKek` is per-tenant, batched (25/call), convergent, and crash-safe
without a cursor: the `kek_version != target` predicate makes any partial run
resumable by simply calling again until `done: true`. Each grant's rewrap
verifies a full decrypt round-trip before its single-row UPDATE.

## v1 simplifications (and their upgrade paths)

- **Registry is code-shipped** (`src/registry/destinations.ts`), not the
  PRD's D1 + KV generation counter. Kill switch = flip `enabled: false` +
  single-worker reship (`.rwx/release.yml`), minutes not seconds; `killTenant`
  covers the tenant-scoped emergency. Upgrade path: move rows to D1 keyed by
  dest id, add a KV generation counter, keep `getDestination()`'s signature.
- **Fleet-wide rotation enumeration is caller-owned.** NFR-2 forbids a
  cross-tenant index, so vault cannot enumerate its own tenants; whoever
  minted the tenants calls `rotateKek` per tenant. Follow-up options: a
  tenant-id-only D1 directory (ids, no secret material) written on first put,
  or the Cloudflare REST API's DO-namespace object listing, operator-side.
- **`inject` buffers bodies** (1 MiB request / 8 MiB response caps in
  `src/types.ts`) and returns a structured `InjectResult` rather than a
  `Response`, so results cross the two RPC hops (caller → entry → DO) with no
  stream-disposal edge cases. Streaming passthrough is a later spike.
- `scope_reduced` health is typed but not yet detected (refresh succeeding
  with narrower scopes still stores them; nothing marks the grant).

## Tests

`bun run test` — @cloudflare/vitest-pool-workers, everything in-runtime:
ciphertext-at-rest raw-SQL scans, AAD/tamper swaps (sandbox→live included),
selection + live rails, fail-closed host allowlist (ordering proven against a
tampered grant), strip+stamp header hygiene, 10-way single-flight refresh,
`runDurableObjectAlarm` sweeps, two-batch rotation, kill-tenant isolation,
secret-free audit + console, and the real RPC surface via the
self-referencing `VAULT_RPC` binding.

Upstream calls are mocked by stubbing `globalThis.fetch` (the DO shares the
test isolate — this is also why `runInDurableObject` works). `fetchMock` from
`cloudflare:test` no longer exists on this pool line. If the DO ever moves
out of this worker's `main`, that mocking strategy breaks — keep it in.

## Ops

Secrets are declared in `packages/secrets/src/manifest.ts` (`bun run secrets`
provisions; dev values are committed in `scripts/dev-config.ts` and seeded by
`bun run env:init`). Env-var contract: `docs/ops/env-vars.md` §vault. No D1,
no migrations lane: the DO schema (drizzle, `src/do/schema.ts` →
`migrations/` bundle via `bun run db:generate`) ships inside the worker and
applies per tenant DO on first touch. Not in `dev-stack.ts` DEFAULT_WORKERS —
boot on demand with `bun run dev vault`.
