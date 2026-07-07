# Roadie / R2 blob storage — provisioning & the binding gotcha

Everything an agent needs to make Roadie-backed images (guestlist user
avatars, store brand/product images; any future consumer app follows the
same pattern) actually render. Two independent things must both be true.

---

## 1. The consumer binding requirement (the silent killer)

**Every worker that binds `ROADIE` MUST declare `entrypoint` + `props.callerApp`
on the service binding.** Roadie's `readCallerApp` (`workers/roadie/src/log.ts`)
resolves `caller_app` from `ctx.props.callerApp` (deploy-pinned, authoritative)
and **throws** if it's absent. That throw happens in the `@instrumented`
`resolveContext` step — so it fails on _every_ roadie call, for _reads and
uploads alike_.

```jsonc
// workers/<app>/wrangler.jsonc  — in BOTH the top level (staging) AND env.production
{
  "binding": "ROADIE",
  "service": "si-roadie-staging", // env.production uses -production
  "entrypoint": "Roadie",
  "props": { "callerApp": "<app>" }, // e.g. "guestlist"
}
```

Canonical reference: `workers/guestlist/wrangler.jsonc` (also
`workers/store/wrangler.jsonc`). A missing `props.callerApp` throws inside
the `@instrumented` `resolveContext` step (`packages/kit/src/log/instrumented.ts`),
which emits an actionable canonical log line with `error_phase:"resolve_context"` —
visible in `wrangler tail` for the affected worker.

The `meta.callerApp` fallback in `readCallerApp` only fires in the
`@cloudflare/vite-plugin` **dev** path (which drops `props`). On real service
bindings (staging/prod) you need `props`.

After editing the config: redeploy the
consumer (e.g. `cd workers/guestlist && bun run deploy:staging`). Confirm the
binding line shows `env.ROADIE (…-roadie-staging#Roadie)` — the `#Roadie`
suffix proves the entrypoint bound.

---

## 2. R2 credentials + CORS (per environment)

Roadie presigns S3-compat URLs against R2 (`workers/roadie/src/sign.ts`). It
needs an **S3 keypair secret** and the bucket needs a **CORS policy** (the upload
path is a browser-direct PUT to R2).

`R2_BUCKET` (`roadie-<env>-blobs`) and `R2_ACCOUNT_ID` (= `CF_ACCOUNT_ID` from
`packages/config/src/deploy.ts`) are already **vars** in each `wrangler.jsonc`.
Only the keypair is missing on a fresh env.

### 2a. Mint the S3 keypair (programmatic — no dashboard)

R2 S3 keys are **account-owned** tokens. Use `POST /accounts/{acct}/tokens` —
**not** `/user/tokens`, which returns `9109 Unauthorized` for a delegated account
(this fork's Cloudflare account is delegated to the dev's login). Access Key ID = the token
`id`; Secret Access Key = **SHA-256 hex of the token `value`** (Cloudflare's
documented derivation). Perm groups: R2 Storage Write `bf7481a1…` + Read
`b4992e11…` (fetch fresh via
`GET /accounts/{acct}/tokens/permission_groups`).

```bash
ACCT=c735c5a53d864bee37400befb7f4c7f4   # platform account (deploy.ts cloudflareAccountId)
CFTOKEN=...                              # a token with account-token-create perms
RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCT/tokens" \
  -H "Authorization: Bearer $CFTOKEN" -H "Content-Type: application/json" \
  -d '{"name":"roadie-<env>-r2","policies":[{"effect":"allow","resources":{"com.cloudflare.api.account.'$ACCT'":"*"},"permission_groups":[{"id":"bf7481a1826f439697cb59a20b22293e"},{"id":"b4992e1108244f5d8bfbd5744320c2e1"}]}]}')
# AccessKeyId = .result.id ; SecretAccessKey = sha256_hex(.result.value)
```

Then set the secrets (wrangler uses OAuth — do NOT export `CLOUDFLARE_API_TOKEN`,
that token likely lacks Workers edit):

```bash
cd workers/roadie
printf %s "$AKID"   | bunx wrangler secret put S3_ACCESS_KEY_ID    --env <env>
printf %s "$SECRET" | bunx wrangler secret put S3_SECRET_ACCESS_KEY --env <env>
```

Note: the minted token is **account-scoped** R2 read+write (bucket-scoping isn't
cleanly expressible via the token API), so it can touch every bucket in the
account. Mint a **separate** token per env so they rotate independently.

### 2b. Bucket CORS (required for uploads)

Admin uploads are **presigned browser-direct PUTs** to
`<acct>.r2.cloudflarestorage.com` — blocked without a bucket CORS policy. (Reads
are presigned GETs loaded as `<img src>`, which do _not_ need CORS.)

The canonical policy lives in code — `workers/roadie/scripts/setup-cors.ts`
(`vp run cors:setup -- --env <local|staging|production|all>`, from
`workers/roadie`) — not a hand-run `curl`/`wrangler` one-off. Origins are
wildcarded per env so any current or future Roadie consumer app on that
domain gets access without a script change:

- **local**: `https://*.somewhatintelligent.localhost`
- **staging**: `https://*.example-account.workers.dev` (bouncer's staging host
  is `staging.somewhatintelligent.ca`; the wildcard also covers `workers.dev`
  preview URLs — update `ORIGINS.staging` in the script if uploads need to
  originate from the bouncer host directly)
- **production**: `https://*.somewhatintelligent.ca` (covers the apex and
  `www`)

If you need to apply the policy without running the script (e.g. verifying a
one-off change), the underlying call is:

```bash
CLOUDFLARE_ACCOUNT_ID=$ACCT bunx wrangler r2 bucket cors set roadie-<env>-blobs --file cors.json
```

where `cors.json` is the R2 API `{"rules":[…]}` shape (**not** the S3 array) —
see `corsPolicy()` in `setup-cors.ts` for the exact fields (methods, allowed
headers, exposed `ETag`, 1h max-age).

### 2c. Verify

Signed `ListObjectsV2` / object `GET` should return **200**. Then, as a
signed-in user, upload/view an avatar through identity's account page and
confirm the `<img>` `naturalWidth > 0` with `src` on
`…r2.cloudflarestorage.com`.
