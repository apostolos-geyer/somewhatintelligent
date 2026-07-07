# Guestlist — IAM Service

Centralized identity and access management for the platform.
Runs on Cloudflare Workers with D1 (SQLite).

## Stack

- **Runtime:** Cloudflare Workers (Elysia + CloudflareAdapter)
- **Auth:** Better Auth with username, jwt, admin, twoFactor, bearer, passkey, deviceAuthorization, apiKey, magicLink, oauthProvider, and organization plugins (the stripe billing plugin loads once `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SIGNING_SECRET` are both set)
- **Database:** Cloudflare D1 (SQLite), Drizzle ORM
- **SSO:** Cross-subdomain session cookie (JWT `cookieCache` strategy, HS256) scoped to `AUTH_DOMAIN`

## Local Development

```bash
# Start dev server (port 8787)
vp run dev

# Verify
curl http://localhost:8787/health
curl http://localhost:8787/providers
```

Local D1 migrations are applied automatically by the repo-root `bun run dev`
(and `bun run migrate`); to apply them by hand for this worker only:

```bash
vp exec wrangler d1 migrations apply DB --local
```

Local secrets go in `.dev.vars` (gitignored, seeded by `scripts/env-init.ts`):

```
BETTER_AUTH_SECRET=<dev secret>
BETTER_AUTH_URL=https://identity.somewhatintelligent.localhost
AUTH_DOMAIN=.somewhatintelligent.localhost
```

D1 local state persists in `.wrangler/state/`. Clear with `rm -rf .wrangler/state`.

## Deploy

Staging deploys on every push to `main`; production deploys on a Release PR
merge (or a one-worker `si-reship-worker` dispatch) — see
[`docs/runbooks/PRODUCTION-DEPLOY.md`](../../docs/runbooks/PRODUCTION-DEPLOY.md).
D1 databases per env are declared in `wrangler.jsonc`; on a fresh fork, create
them and fill in the `database_id`s:

```bash
vp exec wrangler d1 create guestlist-staging-db
vp exec wrangler d1 create guestlist-production-db
# → add the returned database_ids to wrangler.jsonc

# Apply migrations
vp run db:migrate:staging
vp run db:migrate:production
```

Secrets (including `BETTER_AUTH_SECRET`) are provisioned with the codified
`@si/secrets` CLI, not by hand — see
[`docs/runbooks/SECRETS.md`](../../docs/runbooks/SECRETS.md):

```bash
bun run secrets staging
bun run secrets production
```

## Migrations

Schema lives in `src/schema.ts` (Drizzle). To add a migration:

```bash
# Generate SQL from schema changes
vp run db:generate

# Apply locally
vp exec wrangler d1 migrations apply DB --local

# Apply to staging / production
vp run db:migrate:staging
vp run db:migrate:production
```

## Secret Rotation

`BETTER_AUTH_SECRET` is scoped to guestlist only — other workers verify
sessions by calling guestlist over a service binding rather than holding the
secret themselves. To rotate it, update `.secrets/<env>.env` and re-run
`bun run secrets <env>` — see
[`docs/runbooks/SECRETS.md`](../../docs/runbooks/SECRETS.md). Rotating it
invalidates all existing sessions (users re-authenticate).

## Environment Variables

| Variable             | Description                                                                            | Example                                  |
| -------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `BETTER_AUTH_SECRET` | HS256 signing key for session cookies                                                  | (secret)                                 |
| `BETTER_AUTH_URL`    | Origin better-auth mounts `/api/auth` under (same-origin as the browser app)           | `https://somewhatintelligent.ca`         |
| `IDENTITY_URL`       | Identity's public origin (vmf-mounted at `/account`); used for links this worker mints | `https://somewhatintelligent.ca/account` |
| `AUTH_DOMAIN`        | Cookie domain for cross-subdomain SSO                                                  | `.somewhatintelligent.ca`                |
| `DB`                 | D1 binding (configured in wrangler.jsonc)                                              | (automatic)                              |

## Tests

```bash
vp test --filter @si/guestlist-service
```

Integration tests run in workerd via `@cloudflare/vitest-pool-workers`.

## Architecture

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the platform's full architecture reference.

## Releases

Released independently as component tags `guestlist-v<x.y.z>` (release-please manifest mode; see `docs/runbooks/PRODUCTION-DEPLOY.md`).
