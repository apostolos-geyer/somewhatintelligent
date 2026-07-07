# Cloudflare provisioning runbook

`scripts/provision/` is an idempotent, `--dry-run`-safe suite for standing up
this fork's Cloudflare account from zero (or reconciling drift). It uses the
official `cloudflare` TypeScript SDK (v6, `catalog:` pinned in the root
`package.json`), never hardcodes the worker fleet (it scans
`workers/*/wrangler.jsonc` + `inbox/wrangler.jsonc` at runtime), and never
deletes anything.

Ground truth for this fork:

- Account: `c735c5a53d864bee37400befb7f4c7f4`
  ("Apostoli.geyer@geyerconsulting.com's Account")
- Zone: `somewhatintelligent.ca` (`777506a7cc42ec22ffafce16b3d36d06`)
- Public hosts: staging `staging.somewhatintelligent.ca` (Access-protected),
  production `somewhatintelligent.ca`, mail `mail.somewhatintelligent.ca`
  (Access-protected)

Override either default with `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_ZONE_NAME`
env vars if this suite is ever pointed at a different account.

## Files

| File                  | Purpose                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.ts`              | Shared client construction, CLI arg parsing, `[found]/[create]/[update]/[dry-run]` logging, find-or-create helper, permission-group resolution + account/zone policy splitting, wrangler.jsonc JSONC scanning + comment-preserving id backfill, longest-suffix zone matching, CORS origin derivation, `.provision/` secret-file helpers, env-stripped `wrangler secret put`. |
| `tokens.ts`           | Mints `si-deploy` / `si-preview` / `si-access-admin` account-scoped API tokens from the master token.                                                                                                                                                                                                                                                                        |
| `d1.ts`               | Find-or-create D1 databases by name; backfills real `database_id`s into each worker's checked-in `wrangler.jsonc` in place.                                                                                                                                                                                                                                                  |
| `r2.ts`               | Find-or-create R2 buckets; applies CORS; mints roadie's S3-compatible keypair (account-owned token, SHA-256-derived secret) and can push it as Worker secrets.                                                                                                                                                                                                               |
| `access.ts`           | Zero Trust: org auth_domain, staff allow policy, self-hosted Access apps for staging/mail/every `*-staging` workers.dev host, an `si-smoke` CI service token + service-auth policy.                                                                                                                                                                                          |
| `email.ts`            | Email Routing for `mail.<zone>`: subdomain-scoped MX/SPF DNS + catch-all → the inbox worker.                                                                                                                                                                                                                                                                                 |
| `seed-users.ts`       | Seeds idempotent staging smoke-test users via `workers/guestlist/scripts/seed-users.ts`, supplying Access service-token headers.                                                                                                                                                                                                                                             |
| `all.ts`              | Orchestrator: `tokens → d1 → r2 → access → email`, stops on first failure.                                                                                                                                                                                                                                                                                                   |
| `__tests__/*.test.ts` | Unit tests for the pure logic (JSONC scan/backfill, zone matching, permission-group mapping, CORS derivation, seed-user payload build). Run with `bun run test -- scripts/provision/__tests__` (or the root aggregate `bun run test`, which also picks these up).                                                                                                            |
| `tsconfig.json`       | Local typecheck scope for this directory (`bunx tsgo --noEmit -p scripts/provision/tsconfig.json`) — `scripts/` isn't a workspace, so it isn't covered by the root `vp run -r typecheck`; this is the equivalent of `e2e/tsconfig.json`'s pattern for this directory.                                                                                                        |

Additionally, `workers/guestlist/scripts/seed-users.ts` gained optional
`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` env-var support (additive,
no-op when unset) so `seed-users.ts` above can drive it against an
Access-gated staging host.

## Prerequisites

1. **A master `CLOUDFLARE_API_TOKEN`** with, at minimum, "Create Additional
   Tokens" (Account API Tokens = Edit) plus whatever this run's steps touch
   directly (zone read to resolve the zone, etc.) — `tokens.ts` only needs
   token-management + `Zone Read`; every other capability is delegated to the
   tokens it mints. In practice the simplest master token is a broad
   "Super Administrator"-equivalent one used ONLY for bootstrapping, then set
   aside; day-to-day deploys use the minted `si-deploy`/`si-preview` tokens.
2. `CLOUDFLARE_ACCOUNT_ID` is optional (defaults to this fork's account).
3. `bun install` at the repo root (pulls in `cloudflare@6.4.0`).

## Minted tokens and why

| Token             | Permission groups                                                                                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `si-deploy`       | `Workers Scripts Write`, `D1 Write`, `Workers Routes Write`, `DNS Write` (zone), `SSL and Certificates Write` (zone)                                                                                  | `wrangler deploy` needs to push code, apply D1 migrations, AND create the `custom_domain: true` routes this repo's `wrangler.jsonc` files declare. A custom domain provisions a zone DNS record + an edge certificate on first deploy — that's why DNS Write and SSL/Certificates Write are here, not just Workers Routes Write. |
| `si-preview`      | `Workers Scripts Write`, `Account Settings Read`                                                                                                                                                      | PR-preview deploys only push code; no D1/DNS/route capability at all.                                                                                                                                                                                                                                                            |
| `si-access-admin` | `Access: Apps and Policies Write`, `Access: Organizations, Identity Providers, and Groups Write`, `Access: Service Tokens Write`, `Email Routing Rules Write`, `DNS Write` (zone), `Zone Read` (zone) | Everything `access.ts` and `email.ts` need, nothing more — deliberately no Workers Scripts scope.                                                                                                                                                                                                                                |

Permission-group NAMEs are resolved at runtime against
`GET /accounts/{acct}/tokens/permission_groups` (never hardcoded ids) — run
`bun scripts/provision/tokens.ts --dry-run` any time to see the exact names
this account exposes today.

Zone-scoped groups (anything whose Cloudflare scope is
`com.cloudflare.api.account.zone`, e.g. `DNS Write`) go into their own token
policy scoped to `com.cloudflare.api.account.zone.<zone id>`; account-scoped
groups go into a separate policy scoped to
`com.cloudflare.api.account.<account id>`. Cloudflare rejects mixing the two
under one resource bucket, so `lib.ts`'s `buildTokenPolicies` always splits
them.

Secrets land in `.provision/tokens/<name>.json` (gitignored, chmod 600) —
ONLY when a token is freshly created or explicitly rolled (`ROLL=1`);
Cloudflare never returns a token's value again once its create/roll response
scrolls by, and reconciling an existing token's permission groups doesn't
expose it.

## Standing up staging from zero

```sh
# 0. Master token in env (a bootstrapping-only credential — see above).
export CLOUDFLARE_API_TOKEN=...

# 1. Mint the scoped tokens this suite (and CI) will use going forward.
bun scripts/provision/tokens.ts --dry-run     # inspect the plan first
bun scripts/provision/tokens.ts               # .provision/tokens/*.json

# 2. D1 databases + wrangler.jsonc id backfill.
bun scripts/provision/d1.ts --env staging --dry-run
bun scripts/provision/d1.ts --env staging     # edits workers/*/wrangler.jsonc in place

# 3. R2 buckets, CORS, roadie's S3 keypair.
bun scripts/provision/r2.ts --env staging --dry-run
bun scripts/provision/r2.ts --env staging --write-secrets

# 4. Zero Trust Access (staff allow-list + si-smoke CI service token).
ACCESS_EMAILS="you@example.com" \
  bun scripts/provision/access.ts --dry-run
ACCESS_EMAILS="you@example.com" \
  bun scripts/provision/access.ts --write-secrets
#   ^ TEAM_NAME=<slug> only if this account has NO Zero Trust org yet.

# 5. Email Routing for mail.somewhatintelligent.ca -> the inbox worker.
bun scripts/provision/email.ts --dry-run
bun scripts/provision/email.ts

# All five as one orchestrated run (same order, stops at the first failure):
bun scripts/provision/all.ts --env staging --dry-run
bun scripts/provision/all.ts --env staging --write-secrets

# 6. Deploy the fleet (staging = top-level wrangler.jsonc, no --env flag).
#    Canonical order (bouncer LAST — see scripts/deploy-worker.sh):
for w in promoter roadie guestlist identity bouncer; do
  bash scripts/deploy-worker.sh ship "$w" staging
done
cd inbox && bun run deploy   # once inbox/ lands from the parallel rebrand

# 7. Seed idempotent smoke-test users + verify Access.
bun scripts/provision/seed-users.ts --dry-run
bun scripts/provision/seed-users.ts
```

## Idempotency / rerun semantics

- Every step is find-or-create by a STABLE name (token name, database name,
  bucket name, Access app domain, catch-all rule). Re-running with no drift
  prints all `[found]`/`[skip]` and changes nothing.
- **No deletes, anywhere.** Superseding a resource means creating the new one
  and leaving the old one for a human to remove.
- `d1.ts`'s wrangler.jsonc backfill is also idempotent: it only rewrites the
  `database_id` field of the specific JSON object matching the target
  `database_name` (a targeted string replace inside that object's `{...}`,
  not a reserialize), preserving every comment and formatting choice. A
  second run against an already-backfilled file is a byte-for-byte no-op.
- `ROLL=1` (env var, mirrors `tokens.ts`/`r2.ts`) forces a fresh secret for
  an already-provisioned token — do this when a secret is suspected leaked or
  simply to rotate. Without it, an existing token's secret is left alone
  (Cloudflare can't return an old secret again, so this suite never
  overwrites `.provision/*.json` speculatively).
- `--write-secrets` is required before `r2.ts`/`access.ts` will actually run
  `wrangler secret put`; without it they print the exact command instead.
  Either way the underlying Cloudflare API token used for the `wrangler
secret put` subprocess is the wrangler OAuth login, NOT this suite's own
  token — the child process has `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_API_KEY`/
  `CLOUDFLARE_EMAIL` stripped from its env (mirrors
  `agentic-inbox/scripts/setup-access.mjs`).

## Production notes

- Pass `--env production` to `d1.ts`/`r2.ts` (their fields live under each
  worker's `env.production` block, per this repo's wrangler convention —
  named envs do NOT inherit `d1_databases`/`r2_buckets` from the top level).
- `access.ts` is deliberately staging + shared-infra only today
  (`staging.<zone>`, `mail.<zone>`, every `*-staging` workers.dev host) — the
  production apex (`somewhatintelligent.ca`) is public by design and is
  never given an Access app by this suite.
- `email.ts` has no `--env` distinction: Email Routing for `mail.<zone>` is
  one shared piece of zone/DNS infrastructure, not a per-environment
  resource.
- `tokens.ts`'s `si-deploy`/`si-preview` tokens are account-wide (not
  per-env) — the same tokens drive both staging and production deploys via
  `wrangler deploy` / `wrangler deploy --env production`.

## A note on the catch-all's blast radius

`email.ts` provisions Email Routing DNS records scoped to the `mail.<zone>`
SUBDOMAIN only (`emailRouting.dns.create({ zone_id, name: "mail.<zone>" })`)
— the apex (`<zone>`, serving the web app) never gets a Cloudflare-managed MX
record. The zone-wide catch-all rule is safe to point at the inbox worker
specifically BECAUSE of that: with no MX record at the apex, nothing ever
routes there through Cloudflare Email Routing, so in effect the catch-all
only ever fires for `mail.<zone>` addresses. That said, a catch-all is still
a catch-all for whatever domain DOES have the MX record — every address at
`mail.<zone>` (`anything@mail.<zone>`) lands in the inbox worker. Don't reuse
that subdomain for anything else.
