# Secrets Management

Every service is a Cloudflare Worker. Secret provisioning is **codified** in
`packages/secrets`: one manifest (`packages/secrets/src/manifest.ts`) declares
what each worker needs per env, and one command provisions an environment —
writing `.dev.vars` locally and pushing to the deployed workers via
`wrangler secret put --name` remotely.

```sh
bun run secrets local                          # write each worker's .dev.vars secret lines
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets staging
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets production
bun run secrets staging --status               # read-only: exactly what would happen
```

This is **the** flow. See [`runbooks/SECRETS.md`](runbooks/SECRETS.md) for the
manifest, the three value sources (`devDefault` / `generate` / `provided`),
scoping flags, and the attestation-keypair handling. The manual
`wrangler secret put` commands further down are a fallback for one-off pushes.

The target topology (see `docs/ARCHITECTURE.md`) **consolidates secrets to
exactly one holder per concern**:

- `BETTER_AUTH_SECRET` — guestlist only.
- `BNC_ATT_PRIV` — bouncer only.
- `RESEND_API_KEY` — promoter only.
- `S3_*` — roadie only.

Apps hold **no secrets** at all. They consume the bouncer-attestation
public keys (`BOUNCER_ATTESTATION_KEYS` in `packages/config`) as
committed code.

## Local dev

Each service has a `.dev.vars` file that wrangler reads automatically when
running `wrangler dev`. These are gitignored. `bun run bootstrap` (env:init)
creates them with sensible local defaults; `bun run secrets local` (re)writes
the secret lines from the same committed dev defaults in `scripts/dev-config.ts`
(mirrored into the secrets manifest's `DEV_DEFAULTS`):

```
workers/guestlist/.dev.vars      # BETTER_AUTH_SECRET (local placeholder)
workers/bouncer/.dev.vars      # BNC_ATT_PRIV (local placeholder)
workers/roadie/.dev.vars       # S3_* (blank — fill if remote: true)
workers/promoter/.dev.vars     # RESEND_API_KEY (blank — fill to send)
workers/identity/.dev.vars         # only non-secret env vars
```

Local placeholders are declared in `scripts/dev-config.ts`:

- `LOCAL_BETTER_AUTH_SECRET` — guestlist's local cookie-signing key. Only
  signs cookies on `.sproutportal.localhost`; safe to hand-distribute.
- `LOCAL_BNC_ATT_PRIV` — bouncer's local Ed25519 private key. Paired with
  the public key under `kid: "dev"` in `packages/config/src/bouncer-attestation.ts`.
  Local-only; safe to hand-distribute.

**Rotate both per fork** before any non-local deploy.

Secrets bootstrap leaves blank (you must fill in):

| Secret                                                 | Where                          | Used for                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RESEND_API_KEY`                                       | `workers/promoter/.dev.vars`  | Outbound transactional email (sign-up verification, magic links, password reset). Without it, sign-in is blocked by email verification; see README for the D1 bypass.               |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`            | `workers/roadie/.dev.vars`    | Required only if you flip the R2 binding to `remote: true` in `workers/roadie/wrangler.jsonc`. Local miniflare R2 emulation needs no keys.                                         |
| OAuth client id/secret pairs (Google, Microsoft, etc.) | `workers/guestlist/.dev.vars` | Required only if you keep the social-provider plugins wired. The wiring in `auth-config.ts` is gated on the env-var pairs being non-empty, so empty values = social login disabled. |

## Staging / production

Provision with the codified CLI — it resolves each secret's value (generated,
provided, or dev-default) and pushes it to the deployed `sprout-<service>-<env>`
worker for you:

```sh
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets staging
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets production
```

Provided values (Resend key, OAuth pairs) go in the gitignored
`.secrets/<env>.env`; generated values (`BETTER_AUTH_SECRET`, the production
`BNC_ATT_PRIV` keypair) are created on first run and persisted there. Missing
**required** values block the apply with a clear error. Scope with
`--worker <name>` / `--only <SECRET>`, and preview with `--status` or
`--dry-run`. Full details — sources, targeting, the attestation pubkey sync —
are in [`runbooks/SECRETS.md`](runbooks/SECRETS.md).

Required secrets per env:

| Service              | Secret                                                                                                            | Notes                                                                                                                                                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| guestlist            | `BETTER_AUTH_SECRET`                                                                                              | 32-byte base64. **Sole holder** — apps no longer hold this in the target topology. Rotate per env. Invalidates every session on rotation.                                                                                                                           |
| bouncer              | `BNC_ATT_PRIV`                                                                                                    | Ed25519 private key (PEM). Sole holder. Apps verify with the public key set committed in `packages/config/src/bouncer-attestation.ts`.                                                                                                                              |
| roadie               | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`                                                                        | R2 S3 keypair, per-env. Full programmatic mint + bucket CORS + the `ROADIE` binding requirement: [`runbooks/roadie-r2-provisioning.md`](runbooks/roadie-r2-provisioning.md). Images stay blank without ALL of: keypair, CORS, and `props.callerApp` on the binding. |
| promoter             | `RESEND_API_KEY`                                                                                                  | From [resend.com/api-keys](https://resend.com/api-keys). Per-env if you separate sending domains.                                                                                                                                                                   |
| guestlist (optional) | `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `FACEBOOK_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET` | Social-provider OAuth credentials. Wired conditionally — the plugin only loads when both id+secret are present.                                                                                                                                                     |

## What `wrangler.jsonc` carries vs what's a secret

`wrangler.jsonc` files are **checked-in source** (top level = staging,
`env.production` = prod). They hold:

- Non-secret env vars like `BETTER_AUTH_URL`, `IDENTITY_URL`, `EMAIL_FROM`
  (the From: address, not the API key), `AUTH_DOMAIN`, `ENVIRONMENT`.
- Bindings (D1, R2, service bindings).
- Routes / custom domains.

Anything you'd be nervous to commit goes in `.dev.vars` (local) or
`wrangler secret put` (deployed). Never put a real secret in a `wrangler.jsonc`
— these files are committed to git.

## Rotation

The codified path handles rotation too: for the production attestation key,
delete `BNC_ATT_PRIV` from `.secrets/production.env`, run
`bun run secrets production` (regenerates + re-syncs the pubkey into
`bouncer-attestation.ts` + re-pushes the secret), commit the config change, and
redeploy guestlist + bouncer — see [`runbooks/SECRETS.md`](runbooks/SECRETS.md).
The manual `wrangler secret put` steps below are the fallback and document the
sequencing (session invalidation, the kid overlap window) either path follows.

### Rotating `BETTER_AUTH_SECRET` (guestlist)

The HS256 key signing every session cookie. Rotating it invalidates every
active session on that environment. **Single-holder rotation** — no
cross-service coordination required.

1. Generate: `openssl rand -base64 32`.
2. Set on guestlist:
   ```sh
   echo "<new>" | bunx wrangler secret put BETTER_AUTH_SECRET \
     --env production --cwd workers/guestlist
   ```
3. Users sign in again. No apps need to be redeployed; they don't hold this
   secret in the target topology.

### Rotating `BNC_ATT_PRIV` (bouncer)

The Ed25519 key signing bouncer attestation envelopes. Apps verify with
the public key set committed to `packages/config/src/bouncer-attestation.ts`.
Rotation uses a deploy overlap window so no envelope is rejected mid-flight.

1. Generate:
   ```sh
   openssl genpkey -algorithm ed25519 -out priv.pem
   openssl pkey -in priv.pem -pubout -out pub.pem
   ```
2. **PR #1** — add the new `kid: <pub.pem>` entry to `BOUNCER_ATTESTATION_KEYS`
   in `packages/config/src/bouncer-attestation.ts` (both old + new in the
   set). Deploy all apps that participate in the platform.
3. **PR #2** — set bouncer's secret + bump its `BNC_ATT_KID` var to the new kid:
   ```sh
   echo "$(cat priv.pem)" | bunx wrangler secret put BNC_ATT_PRIV \
     --env production --cwd workers/bouncer
   ```
   Deploy bouncer. From this point bouncer signs with the new kid; apps
   accept both during the overlap window.
4. **PR #3** — drop the old `kid` entry from `BOUNCER_ATTESTATION_KEYS`.
   Deploy apps. Old envelopes have a 30s lifetime, so by the time deploys
   finish the old kid is no longer in flight.

No flag day — the overlap is bounded by the envelope's `exp` (30s), not
by deploy timing.

## Appendix — manual `wrangler` fallback

When you need to push a single secret outside the codified CLI, `wrangler secret
put <NAME> --env <staging|production>` (per service) still works. For syncing
many secrets from an encrypted file there's an older helper at
`workers/guestlist/scripts/sync-secrets.sh` — it decrypts via
[dotenvx](https://dotenvx.com) and pipes each value into `wrangler secret put`.
You bring the `.env.<env>` file and `.env.keys`; this template ships no
encrypted env files.

```sh
cd workers/guestlist
./scripts/sync-secrets.sh path/to/.env.staging staging
./scripts/sync-secrets.sh path/to/.env.production production
```

Prefer `bun run secrets <env>` for anything routine — it is idempotent, tracks
generated values, and keeps every worker × env pair in sync from one manifest.
