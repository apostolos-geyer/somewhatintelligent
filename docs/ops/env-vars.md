# Env-var contract

This is the single contract for every environment variable and secret the
platform consumes. **A new env var is not done until it has a row here.** If a
worker reads `env.SOMETHING` (or a script reads `process.env.SOMETHING`) and it
is not in a table below, that is the bug — either add the row or delete the
read. This file is seeded from `scripts/dev-config.ts`, the five per-worker
seeders, every `workers/*/wrangler.jsonc`, `packages/secrets/src/manifest.ts`,
`.rwx/deploy.yml` + `.rwx/release-please.yml`, `docs/secrets.md`, and
`docs/runbooks/SECRETS.md`.

## How to read the source columns

**The dev runtime env is `staging ⊕ .dev.vars`.** Per Spec 02 the top level of
each `wrangler.jsonc` is the STAGING config, so `wrangler dev` loads the
staging `vars` block and then overlays `.dev.vars` on top. The per-worker
seeder only writes the keys that must _differ_ from staging for local
correctness — everything else silently takes its staging value in local dev.
That is why a "dev source" cell can read _wrangler top-level (staging), not
overridden_: the key is real in dev, it just isn't in `.dev.vars`.

| Term in a cell            | Means                                                                                                                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `env-init`                | The per-worker `.dev.vars` seeder, `workers/<w>/scripts/env-init.ts`. `bun run bootstrap` (`vp run -r env:init`) runs all of them.                                                                                                                       |
| `dev-config`              | A `LOCAL_*` constant or `PLATFORM_DEV_VARS` in `scripts/dev-config.ts` — the _value_ a seeder writes.                                                                                                                                                    |
| wrangler var              | Plaintext `vars` entry in `workers/<w>/wrangler.jsonc`. Top-level block = **staging**; `env.production` block = **production**. Checked into git — never a secret.                                                                                       |
| secret (packages/secrets) | Pushed with `wrangler secret put` by `bun run secrets <env>`, driven by `packages/secrets/src/manifest.ts`; values live in the gitignored `.secrets/<env>.env`. **Operator-run and out-of-band — the RWX deploy pipeline does NOT push worker secrets.** |
| blank placeholder         | `env-init` writes the key with an empty value so the file documents it; you fill it in (or leave the feature disabled).                                                                                                                                  |
| absent                    | Not set in that context, by design.                                                                                                                                                                                                                      |

**CI (`.rwx/ci.yml` gate).** The `bootstrap` task runs `bun run bootstrap` (=
`env-init` for every worker), so CI's `.dev.vars` are byte-identical to a fresh
local clone. The gate runs unit/pool tests against miniflare + those seeded
`.dev.vars`; it pushes **no** worker secrets and touches **no** live account.
So for every worker-runtime row the CI source is "seeded (env-init), = dev" and
is omitted from the per-worker tables to keep them legible — only the
deploy/CI-only variables (bottom table) have a distinct CI source.

**CD (`.rwx/deploy.yml` embedded run).** Deploy resolves exactly three secrets
from the locked `greenroom_deploy` RWX vault — `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `GH_TOKEN` — and ships code + D1 migrations. It does
**not** set any worker's runtime secret; those are provisioned separately by an
operator running `bun run secrets <env>` (see the cutover order in
`docs/runbooks/SECRETS.md`).

---

## bouncer (`workers/bouncer`)

Public router + the platform's sole attestation **minter**. Not in the request
path in local dev (dev-direct topology), so several staging vars have no dev row.

| name           | consumed by                      | dev source                                            | staging + production source                                                                                                                                                                                   |
| -------------- | -------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`  | `src/index.ts`                   | `env-init` (`development`)                            | wrangler var (`staging` / `production`)                                                                                                                                                                       |
| `IDENTITY_URL` | `src/index.ts`, `src/session.ts` | `env-init` (`dev-config` `LOCAL_IDENTITY_URL`)        | wrangler var — identity's PUBLIC address (vmf-mounted at `/account`)                                                                                                                                          |
| `BNC_ATT_KID`  | `src/envelope.ts`                | `env-init` (`dev-config` `LOCAL_BNC_ATT_KID` = `dev`) | wrangler var — staging `dev`, production `production`                                                                                                                                                         |
| `BNC_ATT_PRIV` | `src/envelope.ts`                | `env-init` (`dev-config` `LOCAL_BNC_ATT_PRIV`)        | **secret (packages/secrets)** — staging reuses the well-known dev key (`kid=dev`), production is a unique generated Ed25519 keypair. Public halves committed in `packages/config/src/bouncer-attestation.ts`. |
| `ROUTES`       | `src/routes.ts` (`matchRoute`)   | absent (portless routes dev)                          | wrangler var (JSON route table; single-host apex: `/api` passthrough, `/account` vmf, `/` redirect)                                                                                                           |

## guestlist (`workers/guestlist`)

Auth server + sole holder of `BETTER_AUTH_SECRET`. Has local D1.

| name                                              | consumed by                                                              | dev source                                           | staging + production source                                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                                     | `src/auth-config.ts`                                                     | `env-init` (`development`)                           | wrangler var                                                                                                                       |
| `BETTER_AUTH_URL`                                 | `src/auth-config.ts`, `src/index.ts`                                     | `env-init` (`LOCAL_IDENTITY_URL`)                    | wrangler var — same-host ORIGIN only (better-auth appends its own `/api/auth` basePath); NOT identity's `/account`-mounted address |
| `IDENTITY_URL`                                    | `src/auth-config.ts` (`identityUrl` → login/consent/invite-accept links) | `env-init` (`LOCAL_IDENTITY_URL`)                    | wrangler var — identity's PUBLIC address (`.../account`)                                                                           |
| `AUTH_DOMAIN`                                     | `src/auth-config.ts`                                                     | `env-init` (`LOCAL_AUTH_DOMAIN`)                     | wrangler var (`.somewhatintelligent.ca`)                                                                                           |
| `EMAIL_FROM`                                      | `src/auth-config.ts`                                                     | `env-init` (`identity@resend.dev`)                   | wrangler var — staging `identity@resend.dev`, production `somewhatintelligent <hello@somewhatintelligent.ca>`                      |
| `BETTER_AUTH_SECRET`                              | `src/auth-config.ts`                                                     | `env-init` (`dev-config` `LOCAL_BETTER_AUTH_SECRET`) | **secret (packages/secrets)** — generated per env (`required`), rotating it invalidates all sessions                               |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`       | `src/auth-config.ts` (`buildSocialProviders`)                            | `env-init` (blank placeholder)                       | secret (packages/secrets), `provided`/optional — provider disabled if absent                                                       |
| `LINKEDIN_CLIENT_ID` / `LINKEDIN_CLIENT_SECRET`   | `src/auth-config.ts`                                                     | `env-init` (blank placeholder)                       | secret (packages/secrets), `provided`/optional                                                                                     |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | `src/auth-config.ts`                                                     | **absent — not seeded** (see Known inconsistencies)  | secret (packages/secrets), `provided`/optional                                                                                     |
| `FACEBOOK_CLIENT_ID` / `FACEBOOK_CLIENT_SECRET`   | `src/auth-config.ts`                                                     | **absent — not seeded** (see Known inconsistencies)  | secret (packages/secrets), `provided`/optional                                                                                     |

## identity (`workers/identity`)

Dev-direct TanStack Start app. Self-mints its dev attestation envelope (bouncer
isn't in the path on `*.somewhatintelligent.localhost`), so it carries the dev signing
key in `.dev.vars` — but holds no secret in staging/production.

| name           | consumed by                                                   | dev source                                                               | staging + production source                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`  | `src/lib/platform.ts`, `src/components/app-status-pages.tsx`  | `env-init` via `PLATFORM_DEV_VARS` (`development`)                       | wrangler var                                                                                                                                                                                                                                                                                                                                                    |
| `IDENTITY_URL` | `src/lib/platform.ts`, `src/lib/return-to.ts`, sidebar/modals | `env-init` via `PLATFORM_DEV_VARS`; client bundle prefers `PORTLESS_URL` | wrangler var — identity's own PUBLIC address (`.../account` in staging/production; unchanged plain origin in dev — dev-direct never applies the vmf mount). `src/lib/auth-client.ts`'s SSR fallback derives the bare same-host origin from this via `new URL(...).origin` for the `/api` guestlist route, which lives at the origin root, not under `/account`. |
| `AUTH_DOMAIN`  | `src/lib/return-to.ts` (redirect guard)                       | `env-init` via `PLATFORM_DEV_VARS` (`LOCAL_AUTH_DOMAIN`)                 | wrangler var                                                                                                                                                                                                                                                                                                                                                    |
| `BNC_ATT_KID`  | kit dev-envelope stamper (`src/lib/platform.ts`)              | `env-init` (`LOCAL_BNC_ATT_KID` = `dev`)                                 | absent (bouncer mints; app verifies with committed public keys)                                                                                                                                                                                                                                                                                                 |
| `BNC_ATT_PRIV` | kit dev-envelope stamper                                      | `env-init` (`LOCAL_BNC_ATT_PRIV`)                                        | absent (bouncer holds it)                                                                                                                                                                                                                                                                                                                                       |

`import.meta.env.{IDENTITY_URL,AUTH_DOMAIN,ENVIRONMENT}`
are baked into the client bundle at build time by `vite.config.ts` (allowlisted
in `CLIENT_VARS`). The overlay logic there is gated by `SI_BUILD` /
`CLOUDFLARE_ENV` (bottom table) so a dev `.dev.vars` never leaks into a shipped
bundle.

## promoter (`workers/promoter`)

Email transport. `env-init` seeds only the Resend key; `ENVIRONMENT` /
`EMAIL_PROVIDER` fall through to the staging wrangler values in local dev.

| name             | consumed by    | dev source                                              | staging + production source                                                                                                                      |
| ---------------- | -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ENVIRONMENT`    | `src/index.ts` | wrangler top-level (staging), not overridden            | wrangler var                                                                                                                                     |
| `EMAIL_PROVIDER` | `src/index.ts` | wrangler top-level (staging → `resend`), not overridden | wrangler var — staging `resend`, production `cloudflare` (uses the `send_email` `EMAIL` binding, not Resend)                                     |
| `RESEND_API_KEY` | `src/index.ts` | `env-init` (blank placeholder)                          | **secret (packages/secrets)** — `provided`/optional; **staging only** (production sends via the Cloudflare Email binding, so it is unused there) |

## roadie (`workers/roadie`)

R2 blob service. Has local D1. Local dev uses miniflare R2 emulation (needs no
S3 keys); the keypair is only required if you flip `BLOBS` to `remote: true`.

| name                   | consumed by           | dev source                                   | staging + production source                                                |
| ---------------------- | --------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| `ENVIRONMENT`          | worker runtime        | wrangler top-level (staging), not overridden | wrangler var                                                               |
| `R2_BUCKET`            | `src/sign.ts`         | wrangler top-level (staging), not overridden | wrangler var — `roadie-staging-blobs` / `roadie-production-blobs`          |
| `R2_ACCOUNT_ID`        | `src/sign.ts`         | wrangler top-level (staging), not overridden | wrangler var (CF account id)                                               |
| `S3_ACCESS_KEY_ID`     | `src/sign.ts` (SigV4) | `env-init` (blank placeholder)               | **secret (packages/secrets)** — `provided`/optional, per-env R2 S3 keypair |
| `S3_SECRET_ACCESS_KEY` | `src/sign.ts` (SigV4) | `env-init` (blank placeholder)               | **secret (packages/secrets)** — `provided`/optional                        |

Making roadie images actually render needs the keypair **plus** bucket CORS
**plus** `props.callerApp` on every `ROADIE` service binding — see
`docs/runbooks/roadie-r2-provisioning.md`.

## store (`workers/store`)

Dev-direct TanStack Start storefront, vmf-mounted at `/shop` behind bouncer.
Self-mints its dev attestation envelope (bouncer isn't in the path on
`*.somewhatintelligent.localhost`), so it carries the dev signing key in `.dev.vars` — but
holds no secret in staging/production. Binds `DB` (D1), `GUESTLIST`, `ROADIE`.

| name           | consumed by                                                 | dev source                                                                                | staging + production source                                                                                          |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`  | `src/lib/platform.ts`                                       | `env-init` via `PLATFORM_DEV_VARS` (`development`)                                        | wrangler var                                                                                                         |
| `PUBLIC_BASE`  | `src/lib/basepath.ts` → `src/router.tsx` (client basepath)  | `env-init` (`/` — dev-direct has no mount)                                                | wrangler var (`/shop`) — the sole source of the client-only router basepath so the URL bar keeps the mount prefix    |
| `STORE_URL`    | `src/lib/platform.ts` (`expectedHost`), header sign-in link | `env-init` (`https://store.somewhatintelligent.localhost`); client prefers `PORTLESS_URL` | wrangler var — the store's own PUBLIC address (`.../shop`)                                                           |
| `IDENTITY_URL` | `src/lib/auth-client.ts` (SSR `/api` base), sign-in link    | `env-init` via `PLATFORM_DEV_VARS`                                                        | wrangler var — identity's PUBLIC address; SSR derives the bare same-host origin via `new URL(...).origin` for `/api` |
| `AUTH_DOMAIN`  | (platform helpers)                                          | `env-init` via `PLATFORM_DEV_VARS` (`LOCAL_AUTH_DOMAIN`)                                  | wrangler var                                                                                                         |
| `BNC_ATT_KID`  | kit dev-envelope stamper (`src/lib/platform.ts`)            | `env-init` (`LOCAL_BNC_ATT_KID` = `dev`)                                                  | absent (bouncer mints; app verifies with committed public keys)                                                      |
| `BNC_ATT_PRIV` | kit dev-envelope stamper                                    | `env-init` (`LOCAL_BNC_ATT_PRIV`)                                                         | absent (bouncer holds it)                                                                                            |

`import.meta.env.{STORE_URL,IDENTITY_URL,AUTH_DOMAIN,ENVIRONMENT,PUBLIC_BASE}`
are baked into the client bundle at build time by `vite.config.ts`
(allowlisted in `CLIENT_VARS`), gated by `SI_BUILD` / `CLOUDFLARE_ENV` so a dev
`.dev.vars` never leaks into a shipped bundle.

---

## Cross-cutting / build / CI / CD

These are **not** worker-runtime vars — they configure the build, the dev
tooling, or the RWX deploy. None is a `wrangler.jsonc` var.

| name                                                   | consumed by                                                                                                              | dev source                                                                                                            | CI / CD source                                                                                                                                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                                 | `wrangler` (deploy, `secret put`), `packages/secrets/src/run.ts`                                                         | absent — local wrangler uses miniflare; remote bindings / solo-mode / `bun run secrets` need this or `wrangler login` | **CD:** RWX vault `greenroom_deploy.secrets.CLOUDFLARE_API_TOKEN` (`.rwx/deploy.yml` + `.rwx/release-please.yml` `deploy-env` alias). Must be minted **from this fork's CF account** and cover both envs (Workers Scripts Edit + D1 Edit). |
| `CLOUDFLARE_ACCOUNT_ID`                                | `wrangler`, `packages/secrets` (falls back to `platformDeployConfig.cloudflareAccountId`)                                | optional                                                                                                              | **CD:** RWX vault `greenroom_deploy.secrets.CLOUDFLARE_ACCOUNT_ID`.                                                                                                                                                                        |
| `GH_TOKEN`                                             | `scripts/rwx-github-deployment.sh` (GitHub Deployment record)                                                            | n/a                                                                                                                   | **CD:** RWX vault `greenroom_deploy.github-apps.rwx-automation-greenroom.token` (`deployments: write`)                                                                                                                                     |
| `GITHUB_TOKEN`                                         | `.rwx/release-please.yml` (`rp-env` alias — release-please CLI + tag API)                                                | n/a                                                                                                                   | **CI:** same `rwx-automation-greenroom` App token from the vault                                                                                                                                                                           |
| `github.token`                                         | `git/clone` in every RWX file                                                                                            | n/a                                                                                                                   | RWX-provided GitHub App installation token                                                                                                                                                                                                 |
| `GH_DEPLOYMENT_ENV` / `GH_DEPLOYMENT_URL`              | `scripts/rwx-github-deployment.sh`                                                                                       | n/a                                                                                                                   | **CD:** RWX `init.*` params in `.rwx/deploy.yml` (`staging` / `production` + the env URL)                                                                                                                                                  |
| `SI_BUILD`                                             | `workers/identity/vite.config.ts`                                                                                        | unset (dev overlays `.dev.vars` into the client bundle)                                                               | Set to `1` for any shipped build (`deploy:staging` scripts) so seeded `.dev.vars` can never leak into a shipped bundle                                                                                                                     |
| `CLOUDFLARE_ENV`                                       | same vite config (selects the `env.<name>.vars` block) + `wrangler deploy --env`                                         | unset                                                                                                                 | Set to `production` for prod builds (`deploy:production` scripts); staging leaves it unset and relies on `SI_BUILD=1`                                                                                                                      |
| `NODE_ENV` / `VITE_*`                                  | vite `build` task `env` allowlist                                                                                        | per toolchain                                                                                                         | passthrough (build inputs)                                                                                                                                                                                                                 |
| `PORTLESS_URL`                                         | `workers/identity/vite.config.ts` (overrides `IDENTITY_URL` in the client bundle to the branch-prefixed portless origin) | set by `portless` (`bun run dev`)                                                                                     | n/a                                                                                                                                                                                                                                        |
| `PORT` / `HOST`                                        | vite/astro dev servers                                                                                                   | dev tooling                                                                                                           | n/a                                                                                                                                                                                                                                        |
| `NODE_EXTRA_CA_CERTS` / `NODE_TLS_REJECT_UNAUTHORIZED` | `scripts/dev-config.ts` (`DEV_SPAWN_ENV`) — trust portless's local CA for dev `fetch()` / spawned wrangler               | set by `dev-config` when `~/.portless/ca.pem` exists                                                                  | n/a                                                                                                                                                                                                                                        |

---

## Known inconsistencies (found while writing this)

- **`MICROSOFT_*` / `FACEBOOK_*` are consumed and manifested but seeded
  nowhere.** `workers/guestlist/src/auth-config.ts` reads all four OAuth
  providers and `packages/secrets/src/manifest.ts` declares Google, Microsoft,
  Facebook, LinkedIn for every env — but the guestlist seeder
  (`bootstrap.ts`) only writes blank `GOOGLE_*` and `LINKEDIN_*` placeholder
  lines. For local dev the two missing pairs are simply `undefined` (provider
  disabled), so nothing breaks, but the `.dev.vars` template no longer
  documents them. Fix: add the two placeholder pairs to the seeder, or drop the
  unused providers from the manifest.
- **`docs/secrets.md` still says `.platform.localhost`.** The dev cookie/apex
  domain is `.somewhatintelligent.localhost` (`scripts/dev-config.ts`
  `LOCAL_AUTH_DOMAIN`). Two lines in `docs/secrets.md` describing
  `LOCAL_BETTER_AUTH_SECRET` / `LOCAL_BNC_ATT_PRIV` predate the Sprout rebrand.
- **`docs/secrets.md` calls `workers/identity/.dev.vars` "only non-secret env
  vars".** It actually carries the dev attestation signing key
  (`BNC_ATT_KID` + `BNC_ATT_PRIV`) so identity can self-mint its envelope in
  dev-direct topology — matching `manifest.ts` (`BNC_ATT_PRIV.perEnv.local`
  includes `identity`). The prose is stale.
