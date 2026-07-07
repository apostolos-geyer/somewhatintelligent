# Roadie / R2 blob storage — provisioning & the binding gotcha

Everything an agent needs to make brand images (hero slides, logos, product
photos, deck covers) actually render for a Sprout environment. Two independent
things must both be true; getting images working the first time on staging
required discovering both the hard way (2026-07-05).

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
  "service": "sprout-roadie-staging", // env.production uses -production
  "entrypoint": "Roadie",
  "props": { "callerApp": "<app>" }, // e.g. "sprout", "guestlist"
}
```

Canonical reference: `workers/guestlist/wrangler.jsonc`. Sprout shipped
without this for months (`git log -S callerApp` was empty) — images _never_
rendered on staging/prod, and the failure was **invisible**: the worker recorded
`outcome:"exception"` with empty `exceptions[]`/`logs[]` in `wrangler tail`
(pretty format showed `undefined.getReadUrl`). The observability hole itself is
now closed (`packages/kit/src/log/instrumented.ts` wraps `resolveContext` so the
failure emits an actionable canonical line with `error_phase:"resolve_context"`),
so a future missing-`callerApp` will show up in the tail as a real error.

The `meta.callerApp` fallback in `readCallerApp` only fires in the
`@cloudflare/vite-plugin` **dev** path (which drops `props`). On real service
bindings (staging/prod) you need `props`.

After editing the config: redeploy the
consumer (`cd workers/sprout && bun run deploy:staging`). Confirm the binding line
shows `env.ROADIE (…-roadie-staging#Roadie)` — the `#Roadie` suffix proves the
entrypoint bound.

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
(the Sprout account is delegated to the dev's login). Access Key ID = the token
`id`; Secret Access Key = **SHA-256 hex of the token `value`** (Cloudflare's
documented derivation). Perm groups: R2 Storage Write `bf7481a1…` + Read
`b4992e11…` (fetch fresh via
`GET /accounts/{acct}/tokens/permission_groups`).

```bash
ACCT=30ce6004cd9c2907f0b06fe401c4f4ba   # Sprout account (deploy.ts cloudflareAccountId)
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
are presigned GETs loaded as `<img src>`, which do _not_ need CORS.) Origins are
the **portal** hosts:

- **staging** (path mode): `https://sprout-staging.sproutportal.ca`
- **prod** (subdomain mode): `https://sproutportal.ca`, `https://www.sproutportal.ca`, `https://*.sproutportal.ca`

```bash
cat > cors.json <<'JSON'
{"rules":[{"allowed":{"origins":["https://sprout-staging.sproutportal.ca"],"methods":["GET","PUT","HEAD"],"headers":["*"]},"exposeHeaders":["ETag"],"maxAgeSeconds":3600}]}
JSON
CLOUDFLARE_ACCOUNT_ID=$ACCT bunx wrangler r2 bucket cors set roadie-<env>-blobs --file cors.json
```

(Format is the R2 API `{"rules":[…]}` shape, **not** the S3 array.)

### 2c. Verify

Signed `ListObjectsV2` / object `GET` should return **200**. Then load a branded
portal as a signed-in audience member and confirm the hero `<img>` `naturalWidth

> 0`with`src`on`…r2.cloudflarestorage.com`.

---

## 3. Seeding brand images

`workers/sprout/scripts/seed.ts`'s `roadiePut` writes bytes to the bucket via
`wrangler r2 object put` and inserts a `physical_blob` (finalized) +
`blob_reference` (`caller_app:"sprout"`) into `roadie-<env>-db`, then wires
`hero_slides.image_ref` / `portal_config.logo_ref` to the returned referenceId.
`physical_blob.id` **is** the R2 object key. This is independent of roadie's RPC,
so the bytes/rows can be correct while reads still 500 on a bad binding (§1) — fix
the binding, no re-seed needed.

## Environment status (2026-07-05)

- **staging**: binding ✓ (deployed), S3 keys ✓, CORS ✓ — MTL images render.
- **prod**: S3 keys ✓, CORS ✓ (`*.sproutportal.ca`); binding fix committed, ships
  on the next release deploy. No prod brands yet, so nothing to render until then.
