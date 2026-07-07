# Guestlist — IAM Service

Centralized identity and access management for the Platform platform.
Runs on Cloudflare Workers with D1 (SQLite).

## Stack

- **Runtime:** Cloudflare Workers (Elysia + CloudflareAdapter)
- **Auth:** Better Auth with jwt, oauthProvider, admin, twoFactor, bearer, passkey, deviceAuthorization, apiKey plugins
- **Database:** Cloudflare D1 (SQLite), Drizzle ORM
- **SSO:** Cross-subdomain JWT cookie on `.platform.example` (HS256, Approach A)

## Local Development

```bash
# Apply D1 schema locally
vp run db:migrate:local

# Start dev server (port 8787)
vp run dev

# Verify
curl http://localhost:8787/health
curl http://localhost:8787/api/auth/ok
```

Local secrets go in `.dev.vars` (gitignored):

```
BETTER_AUTH_SECRET=local-dev-secret-change-me
BETTER_AUTH_URL=http://guestlist.platform.localhost
AUTH_DOMAIN=.platform.localhost
```

D1 local state persists in `.wrangler/state/`. Clear with `rm -rf .wrangler/state`.

## Deploy

```bash
# Create D1 database (first time only)
vp exec wrangler d1 create guestlist-db
# → add database_id to wrangler.jsonc

# Apply migrations
vp run db:migrate:remote

# Set secrets
echo "<value>" | vp exec wrangler secret put BETTER_AUTH_SECRET
echo "<value>" | vp exec wrangler secret put BETTER_AUTH_URL
echo ".platform.example" | vp exec wrangler secret put AUTH_DOMAIN

# Deploy
vp exec wrangler deploy
```

## Migrations

Schema lives in `src/schema.ts` (Drizzle). To add a migration:

```bash
# Generate SQL from schema changes
vp exec drizzle-kit generate

# Apply locally
vp run db:migrate:local

# Apply to production
vp run db:migrate:remote
```

## Secret Rotation

To rotate `BETTER_AUTH_SECRET`:

1. Set the new secret on ALL apps first (they verify cookies with it)
2. Then set it on guestlist: `echo "<new>" | vp exec wrangler secret put BETTER_AUTH_SECRET`
3. All existing sessions become invalid (users re-authenticate)

## Environment Variables

| Variable             | Description                               | Example                              |
| -------------------- | ----------------------------------------- | ------------------------------------ |
| `BETTER_AUTH_SECRET` | HS256 signing key for session cookies     | (secret)                             |
| `BETTER_AUTH_URL`    | Public URL of this service                | `https://guestlist.platform.example` |
| `AUTH_DOMAIN`        | Cookie domain for cross-subdomain SSO     | `.platform.example`                  |
| `DB`                 | D1 binding (configured in wrangler.jsonc) | (automatic)                          |

## Tests

```bash
vp test --filter @si/guestlist-service
```

Integration tests run in workerd via `@cloudflare/vitest-pool-workers`.

## Architecture

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for the platform's full architecture reference.

## Releases

Released independently as component tags `guestlist-v<x.y.z>` (release-please manifest mode; see `docs/runbooks/PRODUCTION-DEPLOY.md`).
