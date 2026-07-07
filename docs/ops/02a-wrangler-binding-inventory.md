# Spec 02a — Wrangler env-inheritance audit (evidence appendix for Spec 02)

> Companion to [`02-static-wrangler-configs.md`](02-static-wrangler-configs.md).
> Produced from real deploy logs + a full diff of all 7 templates at commit
> `31379a8`. This is the authoritative per-worker checklist for the flip.

## 1. Verbatim warnings from real deploys

**Production** — RWX run `2649bb4053584f7d931fe189ba33a882` (release.yml,
tag v0.2.1), task `deploy-production`
(https://cloud.rwx.com/mint/greenroom/runs/2649bb4053584f7d931fe189ba33a882):

`apps/identity` and `apps/sprout`, ×3 each (client build / ssr build / deploy):

```
▲ [WARNING] Processing wrangler.jsonc configuration:
    - "env.production" environment configuration
      - The following vars exist at the top level, but not on "env.production.vars".
        This is probably not what you want, since "vars" configuration is not inherited by environments.
        Please add these vars to "env.production.vars":
        - BNC_ATT_KID
```

`apps/marketing`, ×2 — from **Astro's generated** `dist/server/wrangler.json`
(+ `.prerender/`), which has no env blocks:

```
▲ [WARNING] Processing dist/server/wrangler.json configuration:
    - No environment found in configuration with name "production".
```

**Staging** — RWX run `463a2448625b44f399c982e36f22d886` (ci.yml, commit
`31379a8`), task `deploy-staging`: identical set with `env.staging` /
`"staging"` substituted.

**Historical (fixed, June)** — GH Actions run 27660201735: sprout warned
`vectorize` / `browser` / `ai` "exists at the top level, but not on
env.staging" — since fixed by repeating them per env. Notable: wrangler only
_warns_ for `vars`, `ai`, `vectorize`, `browser`; other non-inherited keys
(`services`, `d1_databases`, `queues`, `durable_objects`, …) fail **silently at
runtime** as missing bindings. Do not rely on deploy warnings to catch flip
mistakes.

**Context failure** — first prod attempt (run `a44814f2…`, tag v0.1.1) failed
with error 10143 (guestlist bound to not-yet-deployed promoter/roadie):
deploy ORDER is load-bearing, preserve it in every deploy lane.

## 2. Per-worker diff: top-level (dev) vs env.staging vs env.production

⚠ = non-inherited key (must exist per env). After the flip: "S" column becomes
the top level; "P" column stays `env.production` and must be complete on its own.

**promoter**: ⚠vars `ENVIRONMENT` + `EMAIL_PROVIDER` (**resend** S vs
**cloudflare** P); ⚠`send_email:[{name:EMAIL}]` **P-only binding**; prod
observability adds `head_sampling_rate:1`.

**roadie**: ⚠vars `ENVIRONMENT, R2_BUCKET, R2_ACCOUNT_ID` (bucket name per
env); ⚠d1 `DB` (staging/prod ids; top-level dev had NO id); ⚠r2 `BLOBS`
(per-env bucket; dev had `remote:false`); `triggers.crons ["*/15 * * * *"]`
repeated per env; prod observability.

**guestlist**: ⚠vars (S/P only — top level had none): `ENVIRONMENT,
BETTER_AUTH_URL, IDENTITY_URL, AUTH_DOMAIN, EMAIL_FROM` (P uses rendered
`Sprout <hello@sproutportal.ca>`); ⚠services `PROMOTER` (**entrypoint
"Promoter"**) + `ROADIE` (**entrypoint "Roadie", props.callerApp:"guestlist"**)
per env with `-staging`/`-production` names; ⚠d1 per env; prod observability
`{enabled, head_sampling_rate:1, logs}`.

**identity**: ⚠vars `ENVIRONMENT, IDENTITY_URL, MARKETING_URL, SPROUT_URL,
AUTH_DOMAIN` per env (MARKETING_URL: workers.dev host in S, apex in P);
`BNC_ATT_KID` was top-level(dev)-only → the §1 warning; ⚠services `GUESTLIST`
per env; `workers_dev` **true in S only** (P inherits false today).

**sprout** (heaviest): ⚠vars per env (`BRAND_RESOLUTION`: **path** S /
**subdomain** P; `RTK_APP_ID` per env; `BNC_ATT_KID` dev-only → warning);
⚠d1 per env; ⚠durable_objects `GROUP_CHAT_ROOM` + ⚠migrations `v1
new_sqlite_classes:[GroupChatRoom]` repeated in all three blocks (keep tag
FROZEN); ⚠queues producer+consumer (`…-sprout-jobs-staging` S vs
`…-sprout-jobs` P — note prod queue name equals the dev one); ⚠AE dataset;
⚠ai/⚠vectorize (`…-rag-staging` / `…-rag-production` — separate indexes)/
⚠browser repeated per env; ⚠services GUESTLIST + ROADIE (**entrypoint
"Roadie", props.callerApp:"sprout"**) + PROMOTER per env; `workers_dev` true S
only; prod observability `{…, logs}`.

**marketing** (Astro): ⚠`assets {directory:./dist, binding:ASSETS}` — **top
level only today**; confirm it lands in the flipped top level AND that
`env.production` resolves it (assets at top level + no env override — verify
with `wrangler deploy --dry-run --env production`); ⚠vars `MARKETING_URL,
IDENTITY_URL` per env; ⚠d1 per env; ⚠`ratelimits` EARLY_ACCESS_RL namespace
**1003 dev / 1002 S / 1001 P** (distinct namespaces — keep them distinct);
`preview_urls: true` already (only worker with it). No routes (bouncer owns
apex/www).

**bouncer** (public router): ⚠vars per env incl. the JSON-encoded `ROUTES`
routing table (S: guestlist/identity + sprout-staging host; P: + MARKETING
apex/www, SPROUT `/hub`) and `BNC_ATT_KID` (present in BOTH envs here — no
warning); ⚠services: S has 3 (`GUESTLIST, IDENTITY, SPROUT`), **P has 4
(+`MARKETING`)**; ⚠routes custom_domains: S `identity-staging`,
`sprout-staging`; P `identity`, `www`, apex; the `*.sproutportal.ca/*` org
wildcard zone route is **commented out** (2026-07-01 staging-shadow incident —
keep commented until the wildcard plan is re-approved, and if ever re-enabled
it goes in `env.production` ONLY); `workers_dev` true S only; prod
observability `{…, logs}`.

ROADIE `entrypoint+props` total: 6 sites (guestlist ×3 blocks, sprout ×3
blocks) → 4 sites post-flip (2 workers × {top, env.production}). PROMOTER
`entrypoint:"Promoter"`: guestlist blocks only.

## 3. Flip traps ranked

1. **Worker names** (Spec 02 §3.1): without `--env staging`, top-level `name`
   must BE `sprout-<w>-staging`, and `env.production` must set `name`
   explicitly — else new/orphaned workers. Highest risk.
2. **`workers_dev` inversion**: bouncer, identity, sprout have
   `workers_dev:true` in S; after the flip P would INHERIT true → prod gets
   workers.dev enabled. `env.production` must set `"workers_dev": false` for
   those three. (Spec 04 additionally wants `preview_urls: true` top-level /
   `false` in production — same edit, do together.)
3. **BNC_ATT_KID**: do NOT copy it into staging/production vars — it is
   dev-only (kit's envelope stamper is a hard no-op outside
   ENVIRONMENT=development) and dev gets it from the seeded `.dev.vars`
   (sprout/bouncer seeders already write BNC_ATT_KID + BNC_ATT_PRIV). The §1
   warnings disappear because top level stops carrying it. Identity's seeder
   writes only PLATFORM_DEV_VARS — identity's dev stamping relies on
   BNC_ATT_KID today via wrangler top-level vars, so ADD `BNC_ATT_KID=dev` to
   identity's `.dev.vars` seeder as part of the flip (cross-check
   `dev-direct stamper per app` memory / kit docs).
4. **P-only artifacts**: promoter `send_email`; bouncer `MARKETING` binding +
   prod custom_domains; prod observability blocks (`head_sampling_rate`,
   `logs`). None of these may be lost or accidentally hoisted to top level.
5. **Marketing Astro warning** (`No environment found … "production"`) is
   emitted from Astro's generated config, persists after the flip, and is
   harmless — do not chase it. The `"staging"` variant disappears (staging
   stops passing `--env`).
6. **Names that coincide**: sprout's PROD queue name (`sprout-sprout-jobs`)
   equals the old dev name — when flattening, don't "dedupe" it into the
   staging name; staging queue is `sprout-sprout-jobs-staging`.

## 4. Genuine S↔P differences (must survive the flip verbatim)

bouncer topology (services count, ROUTES var, custom_domains); sprout
`BRAND_RESOLUTION` path/subdomain + RTK_APP_ID ids; promoter EMAIL_PROVIDER +
send_email; workers_dev true/false; identity/marketing URL vars
(workers.dev vs apex/www); observability depth; marketing ratelimit
namespaces 1002/1001; queue + vectorize names.
