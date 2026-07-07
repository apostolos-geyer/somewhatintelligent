# Runbook — Secrets provisioning (`@greenroom/secrets`)

Codified, idempotent provisioning of every worker secret across `local`,
`staging`, and `production`. One manifest declares **what** each worker needs;
one command provisions an environment.

- **Package:** `packages/secrets`
- **CLI:** `bun run secrets <env> [flags]` (root) — or `bun packages/secrets/bin/secrets.ts <env>`
- **Manifest (what + where):** `packages/secrets/src/manifest.ts`
- **Value store (the secret values):** `.secrets/<env>.env` — **gitignored, never committed**

## Mental model

A secret is provisioned to **(worker × env)** pairs declared in the manifest's
`perEnv`. Each secret's value comes from one of three **sources** (resolved per
env by `sourceFor`):

| Source       | Meaning                           | Where the value lives                                            |
| ------------ | --------------------------------- | ---------------------------------------------------------------- |
| `devDefault` | Well-known committed dev material | `DEV_DEFAULTS` in the manifest (mirrors `scripts/dev-config.ts`) |
| `generate`   | Generated once, then stable       | `.secrets/<env>.env` (auto-written on first run)                 |
| `provided`   | You supply it                     | `.secrets/<env>.env` (you fill it in)                            |

Resolution rules (already encoded):

- **local** — all generated secrets use the committed dev defaults; provided
  secrets are optional. Applies to each service's `.dev.vars`.
- **staging** — `BETTER_AUTH_SECRET` is generated; `BNC_ATT_PRIV` reuses the dev
  key (staging signs with `BNC_ATT_KID=dev`); `RESEND_API_KEY` is provided.
- **production** — `BETTER_AUTH_SECRET` and a unique `BNC_ATT_PRIV` keypair are
  generated; email uses the Cloudflare Email binding (no Resend key).

Targets: local → `<service>/.dev.vars`; remote → the deployed worker
`sprout-<service>-<env>` via `wrangler secret put --name`.

## Day-to-day

```sh
# See exactly what WOULD happen, read-only — no writes, no wrangler:
bun run secrets staging --status

# Provision an environment (idempotent — safe to re-run):
bun run secrets local                 # writes .dev.vars secret lines
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets staging
CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets production

# Scope it:
bun run secrets staging --worker promoter      # one service
bun run secrets staging --only BETTER_AUTH_SECRET
bun run secrets staging --dry-run              # plan + generate-to-store, no apply
bun run secrets staging --no-generate          # fail if a generated secret is absent
```

Remote envs target Cloudflare — export `CLOUDFLARE_ACCOUNT_ID` so `wrangler`
hits the right account. The CLI passes it through.

## Providing a value (Resend, OAuth, R2/S3)

Provided secrets are read from the gitignored store. Create/edit
`.secrets/<env>.env` (dotenv; multi-line values use `"...\n..."`):

```sh
# .secrets/staging.env
RESEND_API_KEY="re_xxx"
GOOGLE_CLIENT_ID="..."
GOOGLE_CLIENT_SECRET="..."
```

Then re-run `bun run secrets <env>`. Missing **required** values block the apply
with a clear error; missing **optional** values are skipped and reported.

## Generated secrets & the attestation keypair

- `BETTER_AUTH_SECRET` is generated (32 random bytes, base64) on first run for an
  env and persisted to `.secrets/<env>.env`. Re-runs reuse it.
- `BNC_ATT_PRIV` (production) is generated as an Ed25519 keypair. The **private**
  half is stored in `.secrets/production.env`; the **public** half is written
  into `packages/config/src/bouncer-attestation.ts` (kid `production`)
  automatically. **Review and commit that public-key change** — verifiers ship
  it. Then redeploy guestlist so it carries the new public key.

> Rotating the production attestation key: delete `BNC_ATT_PRIV` from
> `.secrets/production.env`, run `bun run secrets production` (regenerates +
> re-syncs the pubkey + re-pushes the secret), commit the config change, and
> redeploy guestlist + bouncer.

## Cutover order (renamed workers)

Secrets land on workers, so the worker must exist first:

1. Deploy the renamed worker(s) for the env (`wrangler deploy --env <env>`).
2. `CLOUDFLARE_ACCOUNT_ID=<acct> bun run secrets <env>` to provision their secrets.
3. If production generated a new attestation keypair, commit the
   `bouncer-attestation.ts` change and redeploy guestlist.
4. Verify, then delete the old (pre-rename) workers.

## Adding a new secret

Append a `SecretSpec` to `SECRETS` in `packages/secrets/src/manifest.ts`
(`name`, `kind`, `required`, `description`, `perEnv`). Everything else — CLI,
`.dev.vars` writing, `wrangler` targeting, status output — flows from it. Add a
test if the resolution rules are non-obvious.

## Tests

`cd packages/secrets && bun run test` — covers key-format correctness (incl. that
the committed dev private key derives the committed dev public key), dotenv
round-tripping, manifest resolution, dev-default drift vs `scripts/dev-config.ts`,
and the orchestrator (idempotency, targeting, generation, dry-run, blocking) via
an in-memory IO/exec double — no network, no real CLI.
