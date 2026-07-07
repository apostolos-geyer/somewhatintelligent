# scripts

Idempotent setup scripts for this deployment. Every script is find-or-create /
find-or-update, so re-running is safe. All account-mutating actions live here
(rather than ad-hoc API calls) so the setup is reproducible and auditable.

Run order for a fresh deploy:

1. `npm run deploy` — deploy the Worker (creates the `workers.dev` hostname).
2. `npm run provision:token` — mint the API token the other scripts need.
3. `npm run setup:access` — put Cloudflare Access in front of the Worker.
4. `npm run setup:email` — route inbound mail to the Worker.

## Instance

This is a single-instance deployment: Worker `agentic-inbox-si`, domain
`mail.somewhatintelligent.ca`. The setup scripts read `name`/`DOMAINS`
straight from the top level of `wrangler.jsonc` (no `CLOUDFLARE_ENV` needed),
and `setup:access` derives its policy name as `<worker>-access`.

```bash
npm run deploy
CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN="$(cat .cf-setup-token)" \
  ACCESS_EMAILS="a@x.com,b@y.com" npm run setup:access
CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN="$(cat .cf-setup-token)" \
  npm run setup:email
```

The `mail.` web UI is served via a Worker [custom domain]; receiving uses MX +
SPF on the subdomain plus the catch-all rule.

[custom domain]: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

---

## provision-token.mjs (`npm run provision:token`)

Idempotently creates/updates the **account-scoped API token** the other scripts
use (Access + Email Routing + DNS + Zone-read). The `wrangler login` OAuth token
lacks these permissions, so this mints a purpose-scoped token from a
higher-privileged "master" token.

```bash
CLOUDFLARE_ACCOUNT_ID=<id> \
CLOUDFLARE_MASTER_TOKEN="$(cat /path/to/master-token)" \
npm run provision:token
```

- Writes the token secret to `OUT` (default `<repo>/.cf-setup-token`, gitignored).
- On re-run: reconciles scopes; leaves the secret in place unless it's missing or `ROLL=1`.
- `REVOKE_NAMES="old-token-name"` revokes superseded tokens.

| Env                       | Default                  | Notes                                                                        |
| ------------------------- | ------------------------ | ---------------------------------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`   | —                        | required                                                                     |
| `CLOUDFLARE_MASTER_TOKEN` | —                        | required; a token allowed to manage API tokens and grant the requested perms |
| `TOKEN_NAME`              | `agentic-inbox-setup`    | managed token name                                                           |
| `SCOPES`                  | full setup set           | comma-separated permission-group names                                       |
| `OUT`                     | `<repo>/.cf-setup-token` | where the secret is written (chmod 600)                                      |
| `ROLL=1`                  | off                      | force-roll the secret                                                        |
| `REVOKE_NAMES`            | —                        | comma-separated token names to revoke if present                             |
| `DRY_RUN=1`               | off                      | print actions only                                                           |

The master token (`CLOUDFLARE_MASTER_TOKEN`) is read from the environment only —
keep it outside the repo. The provisioned token is account-scoped.

---

## setup-access.mjs (`npm run setup:access`)

Idempotent [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
setup: find-or-creates the reusable Access policy + self-hosted application for
the Worker's hostname, reads the application's `aud`, and sets the `POLICY_AUD`
and `TEAM_DOMAIN` Worker secrets the app uses to validate the Access JWT.

```bash
CLOUDFLARE_ACCOUNT_ID=<id> \
CLOUDFLARE_API_TOKEN="$(cat .cf-setup-token)" \
ACCESS_EMAILS="you@example.com" \
npm run setup:access
```

Allow-list with `ACCESS_EMAILS` (comma-separated) and/or `ACCESS_EMAIL_DOMAIN`.
Other env: `WORKER_HOSTNAME`, `TEAM_NAME` (only if no Zero Trust org exists yet),
`POLICY_NAME`, `APP_NAME`, `SESSION_DURATION`, `DRY_RUN=1`, `SKIP_SECRETS=1`.

The Access token is deliberately stripped from the environment before invoking
`wrangler secret put`, so the secret write uses your `wrangler` OAuth login
(Workers Scripts edit) rather than the Access-scoped token.

---

## setup-email-routing.mjs (`npm run setup:email`)

Idempotent [Email Routing](https://developers.cloudflare.com/email-routing/)
setup: finds the zone for your domain, ensures Email Routing is enabled, and
ensures the **catch-all rule** forwards to the Worker so the app's `email()`
handler receives mail.

```bash
CLOUDFLARE_API_TOKEN="$(cat .cf-setup-token)" \
CLOUDFLARE_ACCOUNT_ID=<id> \
npm run setup:email
```

Receives at the domain set in `RECEIVE_DOMAIN` (default: `DOMAINS` in
`wrangler.jsonc`). Other env: `WORKER_NAME`, `RULE_NAME`, `DRY_RUN=1`.

> ⚠️ A catch-all delivers **every** address at the domain into this app. Point
> it at a domain/zone you're comfortable dedicating to the inbox.
