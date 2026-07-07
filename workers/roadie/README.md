# Roadie — Blob Storage Service

Platform blob storage substrate — owns the full lifecycle of user content
across every app on the platform (avatars, tracks, files, images, transfers).
v1 ships as a Cloudflare `WorkerEntrypoint` reachable only over service
bindings; no public HTTP surface.

## Stack

- **Runtime:** Cloudflare Workers (`WorkerEntrypoint`, RPC-only)
- **Metadata:** Cloudflare D1 (SQLite), Drizzle ORM
- **Byte storage:** Cloudflare R2 (native binding for server-side ops;
  S3-compat API via `aws4fetch` for presigning)
- **Scheduled tasks:** pending reaper every 15 minutes

## Specs

- Architecture reference: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) §3.4
- Shipping plan: [`workers/roadie/plan.md`](./plan.md)

## Local Development

```bash
# Apply D1 schema locally
vp run db:migrate:local

# Run tests
vp test

# Start dev server (no public endpoint — fetch returns 404)
vp run dev
```

Local secrets (gitignored) in `.dev.vars`:

```
S3_ACCESS_KEY_ID=test-access-key
S3_SECRET_ACCESS_KEY=test-secret-key
```

Miniflare provides in-memory R2 for tests; SigV4 presigning against the
in-memory R2 is not validated end-to-end (documented gap — see the spec
§Testing requirements and `plan.md` for the manual-integration steps).

## Deploy

Roadie has no `deploy` step you run from CI today — when you're ready to
ship, `wrangler deploy --env <staging|production>` auto-provisions the
Worker. R2 buckets, D1 databases, CORS, and the S3 access-key pair must be
provisioned out-of-band before the first deploy.

### One-time infra (per environment)

```bash
# D1
vp exec wrangler d1 create roadie-staging-db
vp exec wrangler d1 create roadie-production-db
# → write the returned database_id values back into wrangler.jsonc

# R2
vp exec wrangler r2 bucket create roadie-staging-blobs
vp exec wrangler r2 bucket create roadie-production-blobs

# R2 bucket CORS (required for browser-direct uploads/downloads)
# Allowed origins:  https://*.platform.example, https://*.platform.localhost
# Allowed methods:  GET, PUT
# Allowed headers:  Content-Type, Content-Length, x-amz-checksum-sha256, Authorization, Range
# Exposed headers:  ETag, Content-Length, Content-Range, Accept-Ranges
# Max age:          3600
#
# Configure via dashboard or `wrangler r2 bucket cors put <name> --file cors.json`.

# R2 bucket lifecycle (backstop for abandoned multipart uploads)
# Rule: abort incomplete multipart uploads after 7 days.

# R2 S3 access key (for SigV4 presigning)
# Create via Cloudflare dashboard → R2 → Manage API Tokens:
#   Permissions: Object Read & Write
#   Bucket scope: single env-specific bucket
# Each environment gets its own key.

# Push credentials
echo "<access-key-id>"     | vp exec wrangler secret put S3_ACCESS_KEY_ID --env staging
echo "<secret-access-key>" | vp exec wrangler secret put S3_SECRET_ACCESS_KEY --env staging
# (repeat for --env production)
```

### Apply migrations + deploy

```bash
vp run db:migrate:staging
vp run deploy:staging

vp run db:migrate:production
vp run deploy:production
```

D1 migrations are forward-only. The previous Worker version can read a new
schema as long as no destructive migrations have run — rollback = redeploy
the prior version.

## Credential Rotation

`S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`:

1. In the Cloudflare dashboard, mint a new key pair with the same scope
   (single env bucket, read+write).
2. `wrangler secret put` the new value.
3. Redeploy Roadie — module-scope `AwsClient` re-initializes against the
   new key on first call.
4. Wait out the longest signed-URL lifetime (24h) so URLs signed under the
   old key still resolve.
5. Revoke the old key in the dashboard.

## Environment Variables

| Variable               | Type    | Description                                               |
| ---------------------- | ------- | --------------------------------------------------------- |
| `ENVIRONMENT`          | var     | `development`, `staging`, or `production`                 |
| `R2_BUCKET`            | var     | Bucket name (for S3-API path construction and log fields) |
| `S3_ACCESS_KEY_ID`     | secret  | R2 S3-compat access key                                   |
| `S3_SECRET_ACCESS_KEY` | secret  | R2 S3-compat secret                                       |
| `DB`                   | binding | D1 database (metadata)                                    |
| `BLOBS`                | binding | R2 bucket (byte storage)                                  |

The Cloudflare account id lives as a constant in `src/config.ts` (same value
across envs). The R2 S3-compat endpoint is derived from it at signing time.

## Consumer Integration

Consumer Workers reach Roadie over a service binding. Every consumer's
`wrangler.jsonc` declares a `props.callerApp` so Roadie's caller identity
is tamper-resistant:

```jsonc
"services": [
  {
    "binding": "ROADIE",
    "service": "roadie",
    "entrypoint": "Roadie",
    "props": { "callerApp": "<consumer-name>" }
  }
]
```

Generate consumer types with:

```bash
wrangler types -c ./wrangler.jsonc -c ../../workers/roadie/wrangler.jsonc
```

The generated `env.ROADIE` is `Service<typeof import(".../workers/roadie/src/index").Roadie>` — every RPC method is callable with full IntelliSense including the result discriminated union.

Integration patterns (single-part, multipart, server-side `put`, read,
reference share) are specified in the service spec §Usage Patterns.

## Runbook

Roadie emits one canonical log line per RPC invocation with `service:
"roadie"`, `event: "rpc"`, `operation`, `outcome`, `request_id`, `caller_app`,
`actor_kind`, `actor_id`, `duration_ms`, and operation-specific fields. See
spec §Observability and RFC §19 for the full schema and forbidden-field
list.

**Likely failure modes:**

- **`backend_unavailable` spikes on `finalize` / `put` / `getReadUrl`** —
  R2 outage or credential drift. Check Cloudflare R2 status; verify
  `S3_ACCESS_KEY_ID` is still valid in the dashboard. Signed URLs issued
  before the outage continue to work within their lifetime.
- **Stuck rows in `deletion_queue`** — backend delete failed mid-call.
  v1 records the failure but does not retry (see spec §Deferrals). Query
  the table for `last_error` + `attempts`; clear manually after fixing
  the upstream cause (usually a lingering access-scope issue).
- **Pending blob count climbing** — pending reaper failing or lagging.
  Check cron firings; manually invoke `adminTriggerTask({ task:
"pending_reap" })` via a consumer admin surface.
- **Signed-URL cache bloat** — `signed_url_cache` grows without bound.
  v1 has no vacuum task; rows past `expires_at` are effectively stale
  but harmless (the cache-hit check filters them). Cleanup is a future
  maintenance task.

**Rollback:** Redeploy the prior Worker version. Schema is forward-only
but v1 has no destructive migrations — the older Worker binary reads the
current schema correctly.

## Architecture

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the platform
context (§3.4 roadie components).

## Releases

Released independently as component tags `roadie-v<x.y.z>` (release-please manifest mode; see `docs/runbooks/PRODUCTION-DEPLOY.md`).
