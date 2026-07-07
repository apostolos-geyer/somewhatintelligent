# 07 — Deployment, Environments & Cadence

> **Scope.** How the single Sprout app (`workers/sprout`, worker
> `sprout-sprout` → `sprout-sprout`) is registered as a new
> Cloudflare Worker, wired into D1 migrations + CI/CD, ordered against the rest
> of the worker set, secured per environment, and shipped on a trunk-based
> continuous-deploy-to-staging cadence with gated promotion to production. It is
> grounded entirely in greenroom's real deploy machinery — each `wrangler.jsonc`,
> `deploy.ts`, the RWX CI/CD lanes (`.rwx/ci.yml` gate + `.rwx/promote-staging.yml`
> staging + `.rwx/release-please.yml` production), the shared per-worker
> `scripts/deploy-worker.sh`, `.githooks/`, and the secrets manifest. Every claim
> cites a real file.
>
> **Naming note (frozen).** The canonical, single name is **`sprout`**: dir
> `workers/sprout`, worker `sprout-sprout` → `sprout-sprout`, D1 token
> `D1_SPROUT`, service binding `SPROUT`, URL var `SPROUT_URL`, roadie
> `caller_app: "sprout"`. Earlier `apps/portal` / `sprout-portal` / `D1_PORTAL` /
> `PORTAL` drafts are dead — do **not** rename to `portal`/`PORTAL`. This name
> must be identical across `deploy.ts`, each `wrangler.jsonc`,
> the bouncer config, the secrets manifest, and
> `portless.json`, or one of those surfaces silently no-ops. The `sprout-sprout`
> worker string is cosmetic: `workerPrefix = sprout` (confirmed in `deploy.ts`),
> so the doubling is mechanically identical to every other worker name (e.g.
> `sprout-guestlist`) and is deploy-internal — never user-facing (users hit
> `*.sproutportal.ca`).
> §8's registration checklist freezes `sprout` as the single source of truth.

---

## 1. Adding `sprout` as a worker

The Sprout app is the canonical full-featured worker: it has its own D1-backed
data model and queue/scheduled jobs, a Durable-Object real-time layer,
`ROADIE` + `PROMOTER` service bindings, and three additional `AI` +
`VECTORIZE` + `BROWSER` (Browser Rendering) bindings — none of which exist
elsewhere in greenroom today. Its
`wrangler.jsonc` is a checked-in source file (top level = staging,
`env.production` = prod) — you edit it directly.

**§1.1 is the single canonical registry of wire-level binding identifiers**
(queue/AE/DO names, service bindings). Docs 03/05 reference these generically;
their `*_JOBS_QUEUE` resolves to `SPROUT_JOBS_QUEUE` here, and the DO binding is
`GROUP_CHAT_ROOM`. Cross-link this table when wiring those docs.

### 1.1 `wrangler.jsonc` bindings

Sprout's `wrangler.jsonc` is a DO-bearing skeleton: alongside the
D1/DO/queue/AE/service bindings below, it adds the AI binding and apex +
wildcard route awareness. Every binding must be **repeated in each `env`
block** — Cloudflare does **not** inherit top-level
`d1_databases`/`durable_objects`/`queues`/`services`/`vars` into
the named `env.production`, which is why the config re-declares all of
them there.

| Binding             | Kind                                                              | Token / value                                                                                                                                     | Notes                                                          |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `DB`                | D1                                                                | `database_id` (staging id at top level, prod id in `env.production`), `migrations_dir: "migrations"`                                              | Sprout's own D1 binding (§1.2 covers the D1 wiring)            |
| `GROUP_CHAT_ROOM`   | Durable Object (class `GroupChatRoom`)                            | `durable_objects.bindings[{name:"GROUP_CHAT_ROOM", class_name:"GroupChatRoom"}]` + `migrations[{tag:"v1", new_sqlite_classes:["GroupChatRoom"]}]` | Sprout's own Durable Object binding (DO migration tags, below) |
| `SPROUT_JOBS_QUEUE` | Queue (producer + consumer)                                       | `sprout-sprout-jobs`                                                                                                                              | Sprout's own producer + consumer queue binding                 |
| `AE`                | Analytics Engine dataset                                          | `sprout_sprout_events`                                                                                                                            | Sprout's own Analytics Engine dataset binding                  |
| `GUESTLIST`         | service binding                                                   | `sprout-guestlist[-env]`                                                                                                                          | Sprout's own service binding into guestlist's auth backend     |
| `ROADIE`            | service binding (entrypoint `Roadie`, `props.callerApp:"sprout"`) | `sprout-roadie[-env]`                                                                                                                             | `workers/guestlist/wrangler.jsonc` roadie binding shape        |
| `PROMOTER`          | service binding (entrypoint `Promoter`)                           | `sprout-promoter[-env]`                                                                                                                           | `workers/guestlist` promoter binding shape                     |
| `AI`                | Workers AI binding (embeddings + generation, binding path)        | `{ "binding": "AI" }`                                                                                                                             | **NEW — none exist in greenroom today**                        |
| `VECTORIZE`         | Vectorize index binding (brand-scoped RAG vectors, 768-dim)       | `[[vectorize]] binding="VECTORIZE" index_name="sprout-sprout-rag"`                                                                                | **NEW — none exist in greenroom today**                        |
| `BROWSER`           | Browser Rendering binding (PDF page-1 thumbnail render)           | `{ "binding": "BROWSER" }`                                                                                                                        | **NEW — none exist in greenroom today**                        |

`vars` per env include: `ENVIRONMENT`
(`development`/`staging`/`production`), `SPROUT_URL` (the public host —
`https://*.sproutportal.localhost` dev convention via the wildcard, or a pinned
landing host), `IDENTITY_URL`, and `BNC_ATT_KID: "dev"` (the dev-stamper key id;
production flips to `production`). `BNC_ATT_PRIV` stays in `.dev.vars`, never the
template — it is the dev-envelope **signing** key and is a hard no-op outside
`ENVIRONMENT=development`.

**DO migration tags.** The `migrations` array is stateful and tags must be
monotonic. Sprout ships **exactly one** DO class,
`GroupChatRoom` (binding `GROUP_CHAT_ROOM`), and `v1` is **frozen** at
`new_sqlite_classes: ["GroupChatRoom"]`. One class covers both real-time
surfaces, addressed per-room via `idFromName`: group chat =
`idFromName(brandId)` (one instance per brand); feed live-comments =
`idFromName(\`${brandId}:${postId}\`)`(one instance per post). A brand chat
room and a post-comment room are the **same shape** (durable message log in DO
SQLite + presence + hearts), so a second class would duplicate code for zero
behavioural gain and enlarge the irreversible`v1`set.`MediaFeedRoom`is a
**documented future`tag: "v2" new_sqlite_classes: ["MediaFeedRoom"]`escape
hatch only** — additive and allowed if a single post's comment fan-out ever
needs independent hibernation/sharding, never shipped in`v1`. Renaming or
removing a DO class later needs a `renamed_classes`/`deleted_classes`migration
entry, never an edit to`v1`. The DO class is exported only at the worker entry
(`workers/sprout/src/worker.ts`, e.g. `export { GroupChatRoom } from "./room-server"`), and the whole `durable_objects`+`migrations`block is **repeated at the top level (staging) and in`env.production`\*\*.

**The AI + Vectorize + Browser + Realtime bindings.** None exist anywhere in
greenroom today (grep-confirmed). Sprout adds three new **bindings** plus the
RealtimeKit **secrets**:

- **Workers AI** binding `{ "binding": "AI" }`, read via
  `createServerOnlyFn(() => env.AI)`, behind the AI module's single `generate()`
  seam. Generation model = `@cf/meta/llama-3.1-8b-instruct` (or the current
  CF-recommended instruct model at build time); embeddings =
  `@cf/baai/bge-base-en-v1.5` (768-dim). **No AI secret is provisioned for v1** —
  the binding path carries auth implicitly. Swapping to an **external LLM** is a
  one-file change at the `generate()` seam and is a documented opt-in (a `provided`
  SecretSpec scoped to `["sprout"]`), **NOT provisioned** in v1.
- **Vectorize** binding (`[[vectorize]] binding="VECTORIZE"
index_name="sprout-sprout-rag"`) for the brand-scoped RAG vectors —
  the index is created once with `wrangler vectorize create` at **dimension 768**
  (matching `@cf/baai/bge-base-en-v1.5`) with a `brand_id` metadata filter.
- **Browser Rendering** binding `{ "binding": "BROWSER" }` — the supported CF path
  for the deck PDF page-1 PNG thumbnail (headless screenshot) in the `deck.derive`
  queue job; PDF page-count + corpus text come from `unpdf` (no native deps), and
  the client flip-viewer uses `pdfjs-dist` (per the PDF-renderer decision).

For booked/group-session rooms, **RealtimeKit** (UI Kit client + account-scoped
REST server) is the settled transport. Its config splits by sensitivity: the
**App id** (`RTK_APP_ID`) + **account id** (`CF_ACCOUNT_ID`) are non-secret
**wrangler `vars`** rendered from `deploy.ts` (`rtk.{staging,production}` +
`cloudflareAccountId`), while the **API token** (`RTK_API_TOKEN`, Realtime-scoped)
is the only **`wrangler secret`** (`provided` SecretSpec scoped to `["sprout"]`,
§4.4). Provision the App + presets with
`bun scripts/provision-realtimekit.ts --env <env> --app-name sprout-<env>`, paste
the returned id into `deploy.ts`, put the minted token in `.secrets/<env>.env`, and
push it with `bun run secrets <env>` (after the sprout worker is deployed —
secrets land on an existing worker, per docs/runbooks/SECRETS.md). Managed recording
egresses to the project R2 bucket and the recording-complete webhook registers the
object with roadie. Every binding/key is read **inside `fetch` or a server-only
fn**, never at module top level — reading `cloudflare:workers` `env` at module load
leaks binding values into the client bundle. Sprout's own `worker.ts` guards
this with a module-level `configChecked` latch, checked on first `fetch`.

### 1.2 D1 database ids

Create the Sprout D1 databases (`wrangler d1 create sprout` per env) and set each
`database_id` directly in the `d1_databases` blocks of
`workers/sprout/wrangler.jsonc` — the staging id at the top level, the production id
in `env.production`:

```jsonc
// top level (staging)
"d1_databases": [
  { "binding": "DB", "database_name": "sprout-staging-db",
    "database_id": "<uuid from wrangler d1 create sprout>", "migrations_dir": "migrations" }
],
// env.production
"d1_databases": [
  { "binding": "DB", "database_name": "sprout-production-db",
    "database_id": "<uuid>", "migrations_dir": "migrations" }
]
```

Local dev keys on `database_name`, so no id is needed there. The `account_id`,
`sproutportal.ca` / `sproutportal.localhost` domains, and worker names are
literals already present in the config — Sprout reuses them. After editing the
config or `deploy.ts`, run `cd workers/sprout && bun run types` to refresh the
`worker-configuration.d.ts` (the typed `Env`), or typecheck reads a stale shape.

### 1.3 How bouncer routes brand subdomains to Sprout

One worker serves **every** brand portal via a single wildcard host. Add to
`workers/bouncer/wrangler.jsonc` in **both** blocks (the top level — which
IS staging — and `env.production`; named-env bindings are not inherited):

- A **service binding**: `{ "binding": "SPROUT", "service": "sprout-sprout[-env]" }`
  alongside the existing GUESTLIST/IDENTITY bindings
  (`workers/bouncer/wrangler.jsonc:58-65,146-151`).
- A **wildcard route** in `vars.ROUTES.routes[]`:
  `{ "binding": "SPROUT", "host": "*.sproutportal.ca", "path": "/", "mode": "passthrough" }`
  plus the apex `{ "binding": "SPROUT", "host": "sproutportal.ca", "path": "/" }`
  for the Hub. bouncer already supports single-label `*.`-prefixed wildcard
  hosts (`workers/bouncer/src/routes.ts:3,183`); specificity is \*\*exact > wildcard
  > no host\*\* (`workers/bouncer/src/routes.ts:7`), so any exact host
  > (e.g. `identity.sproutportal.ca`) still wins over the Sprout
  > wildcard — verify no brand slug collides with an existing app hostname.
- For staging/production, a `routes[].custom_domain` entry for the public host
  (`workers/bouncer/wrangler.jsonc:85-89,139-143`). The chosen mechanism
  is a **single wildcard custom-domain route `*.sproutportal.ca` on the bouncer
  worker backed by a zone wildcard TLS cert** (Advanced Certificate Manager /
  Total TLS for `*.sproutportal.ca`) — **NOT** Cloudflare for SaaS custom
  hostnames. Every brand is a subdomain of the operator's own apex
  `sproutportal.ca`, so one wildcard cert + one route covers all brands with zero
  per-brand provisioning — exactly the "a new brand is a row of data" goal.
  Cloudflare for SaaS is reserved for the future case where a brand brings its
  **own** apex/vanity domain (add it for a single brand only if it later needs its
  own apex; not part of v1). Ordering the wildcard cert + confirming the route
  binds is a prerequisite (§9 Prerequisites).

bouncer needs **no code change**: it resolves the `SPROUT` fetcher dynamically
off the rendered `services[]` via `Reflect.get` and matches the route from
config (`workers/bouncer/src/index.ts:40-53`). `mode: "passthrough"` (not
`vmf`) — the app owns its host fully. The wildcard
matches a **single label only**: `mtlcannabis.sproutportal.ca` matches,
`a.b.sproutportal.ca` does not (`workers/bouncer/src/routes.ts:248`).

The portal then resolves the brand from the `Host` header at runtime (the
**runtime per-org brand** mechanism, doc 01 §2, doc 03 "Host → brand"). This is
**not** a build-time-brand concern — the build-time brand system in
`packages/config` brands the whole Sprout fork once; per-brand skins are a D1
read keyed by `org_id`.

---

## 2. D1 migrations in CD (migrations-before-code)

### 2.1 Migrations run before code, per worker

Every RWX deploy lane migrates a worker's remote D1 **before** deploying its
code, so a freshly-deployed worker never reads a schema the database lacks. The
one place this happens is the shared `scripts/deploy-worker.sh ship <worker>
<env>`, which runs the worker's `db:migrate:<env>` (D1-backed workers only) and
then deploys — the same helper the staging lane (`.rwx/promote-staging.yml`,
embedded from `.rwx/ci.yml`) and both production lanes (`.rwx/release-please.yml`,
`.rwx/release.yml`) call.

Sprout already carries the remote-migrate scripts. Because the wrangler.jsonc
**top level is staging**, the staging apply takes **no** `--env`:

```jsonc
"db:migrate:staging":    "wrangler d1 migrations apply DB --remote",
"db:migrate:production": "wrangler d1 migrations apply DB --remote --env production",
```

(alongside the `db:migrate:local` vp task in `workers/sprout/vite.config.ts` that
`bun run migrate` fans out to locally). No CD edit is needed to enrol Sprout:
`scripts/changed-workers.sh` maps a `workers/sprout/**` change to the sprout
deploy, and `deploy-worker.sh ship` migrates it before shipping. A production
deploy uses the same helper with `db:migrate:production`.

**No backfill needed for marketing.** `marketing` is Astro with **no** remote
D1, so `deploy-worker.sh` runs no migrate for it. Quiz and chat's D1 concerns
were resolved by folding both into Sprout as sections (§3.2) rather than by
maintaining separate migrate scripts for them as standalone workers.

### 2.2 The DO migration tags

DO schema is **not** a SQL migration — it is the wrangler `migrations[]` array
(§1.1), applied **at `wrangler deploy` time** as part of the worker upload, not
by `wrangler d1 migrations apply`. `tag: "v1"` ships the single `GroupChatRoom`
class; the DO's **own** SQLite tables must be created idempotently (e.g.
`IF NOT EXISTS`) in whatever lifecycle hook runs table setup, because DOs
hibernate and that hook re-fires on wake. So there are two distinct migration
lanes for Sprout, both repeated per env:

- **D1 (the portal's domain tables)** — `db:migrate:staging` step, before code.
- **DO classes** — the `migrations[]` tag block, applied by the `deploy` itself.

### 2.3 Rollback / forward-only policy

D1 migrations are **forward-only** — `wrangler d1 migrations apply` has no
down-migration. The repo encodes this implicitly: generated SQL is
`migrations/NNNN_name.sql` and **never hand-edited** (doc 02 migrations
strategy; exception: the two hand-appended `reviews` CHECK constraints). The
rollback story is therefore:

- **Schema rollback = a new forward migration** that reverses the change
  (`NNNN+1`), never an edit to an applied file. An applied migration is
  immutable.
- **Code rollback = re-deploy the prior green commit** (revert on `main`, or for
  production re-ship one worker at an older tag via `.rwx/release.yml`'s
  `reship-worker` dispatch). Because migrations run first and are
  additive/forward-only, a code
  rollback is safe **as long as the new migration was additive** (new
  nullable columns, new tables) — the prior code ignores columns it doesn't
  read. **Destructive migrations (drop/rename a column the live code still
  reads) break this** and must be staged across two deploys (expand → migrate →
  contract), exactly as a DO class rename needs `renamed_classes` rather than an
  in-place edit.
- **DO migrations are effectively irreversible** for `new_sqlite_classes`
  (you cannot un-create a stateful class with live instances without a
  `deleted_classes` migration that destroys state). This is why `v1` is frozen at
  the single `GroupChatRoom` class up front (§1.1).

This policy matches the **append-only** discipline already in the data model:
`analytics_events` and the carried-over `audit_log` are never UPDATEd/DELETEd
(doc 02 conventions), so the immutable-history posture extends naturally to
the migration history itself.

---

## 3. Deploy ordering with Sprout

The ordered deploy is: **per-worker D1 migrate → leaf services → apps (incl.
Sprout) → bouncer LAST** (migrate is folded into each worker's `ship`, §2.1).
bouncer is always last so the public router only ever points at
already-deployed, already-migrated upstreams. The canonical fleet order lives in
`.rwx/deploy.yml`'s `deploy` task and is honoured by both the changed-subset
staging lane and the released-subset production lane; each worker ships through
`scripts/deploy-worker.sh ship <worker> <env>`:

```sh
# canonical order, migrate-before-code per worker (scripts/deploy-worker.sh):
deploy-worker.sh ship promoter   <env>   # leaf service — email
deploy-worker.sh ship roadie     <env>   # leaf service — storage/assets
deploy-worker.sh ship guestlist  <env>   # auth/identity backend leaf
deploy-worker.sh ship identity   <env>   # app
deploy-worker.sh ship marketing  <env>   # app — Astro SSR worker
deploy-worker.sh ship sprout     <env>   # app — portal + admin + hub
deploy-worker.sh ship bouncer    <env>   # public router — LAST
```

Sprout slots into the **apps** band alongside identity and marketing, after the
leaf services and before bouncer. The staging lane deploys only the workers a
push actually touches (`scripts/changed-workers.sh`), but always in this order —
a `workers/sprout/**`-only change ships just sprout; a `packages/*` change fans
out to all seven.

Why Sprout must precede bouncer specifically: bouncer's `SPROUT` service binding
(§1.3) resolves at request time against the deployed `sprout-sprout[-env]`
worker. If bouncer deployed first with a binding to a not-yet-deployed worker,
the wildcard route would 503 until Sprout landed. The ordering guarantees the
binding target exists before the router that references it.

Quiz and chat have already **fully folded into** Sprout (doc 03): their
standalone deploy steps and bouncer exact-host routes have been removed, so
Sprout's wildcard route is the only path serving those sections today. §3.2
covers what that deploy-surface teardown consisted of.

### 3.1 The credential gate

The deploy tasks unlock the main-locked `greenroom_deploy` vault
(`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, and the GitHub-app token for the
Deployment record); the staging deploy only runs on a push to `main` (gated on
`init.deploy` in `.rwx/ci.yml`), and a local `rwx run .rwx/ci.yml` leaves deploy
off by default. Adding Sprout changes **nothing** here — the gate is
vault/branch presence, not per-worker. The `wrangler.jsonc` files (including
Sprout's) are checked-in source, so no pre-deploy generation step runs before
`wrangler deploy`.

### 3.2 Deploy-surface consolidation under Sprout

Quiz and chat's functionality now lives inside Sprout as sections
(`?section=quizzes` / `?section=chat`); their standalone deploy surfaces —
their entries in the changed/deploy worker set, bouncer
exact-host routes and service bindings, their local `db:migrate:local` vp tasks,
`portless.json` and secrets-manifest entries, and their
`wrangler.jsonc` `d1` blocks — have already been removed, and the
`apps/quiz`/`apps/chat` directories deleted. Sprout's own registration
checklist (§8) is the current source of truth for what a fresh deploy needs to
wire.

Cross-link doc 09 §7 for the data-move/blob side. Greenfield forks have no legacy
blobs to move (doc 01 §9: greenfield = no-op for the roadie re-reference backfill);
a **data-carrying** fork that still has quiz/chat production data from before
the fold-in additionally runs the one-time re-register-under-`sprout`
roadie backfill (P2.D quiz / P3 chat) so those blobs resolve under
`caller_app: "sprout"`.

---

## 4. Environments

Three environments, each with a distinct topology and secret set.

### 4.1 Local (portless / wrangler dev + dev-envelope stamper)

- **Topology is dev-direct**: bouncer is **not** in front of the app's public
  host locally, so each app **self-mints** a dev envelope via the
  `devEnvelopeStamper` invoked at the worker entry. Without it, `getEnvelope` returns null and
  every principal-gated server fn / the admin gate 307-loops (project memory
  `dev_direct_stamper_per_app`). Sprout **must** wire `devEnvelopeSigner` +
  `devEnvelopeGuestlist` in `lib/platform.ts` and call `devEnvelopeStamper` in
  `worker.ts` (doc 03). It is a hard no-op when `ENVIRONMENT !== "development"`.
- **Start it** with `bun run bootstrap` (`vp run -r env:init` — seeds every
  worker's `.dev.vars`) then `bun run dev` (`bun scripts/dev-stack.ts` — one
  command: cached `env:init` + local D1 migrations, then boots
  guestlist+identity+sprout+roadie), or for the branded portless URL
  `cd workers/sprout && bun run dev` (the per-app `portless` key drives the named
  `*.sproutportal.localhost` URL). The single-service `cd … && bun run dev` is the
  pattern for exercising the wildcard brand subdomains (CLAUDE.md local-dev
  workflow).
- **Local D1 migrations are registered**: Sprout declares a `db:migrate:local` vp
  task in `workers/sprout/vite.config.ts` (`wrangler d1 migrations apply DB
--local`); root `bun run migrate` (`vp run -r db:migrate:local`) and `bun run
dev` (`scripts/dev-stack.ts`) fan out to it, so Sprout's local migrations apply
  automatically. Any new app-level worker with its own D1 needs its own
  `db:migrate:local` task, or it silently gets no local migrations (doc 02
  migrations strategy step 3).
- **portless**: add `"workers/sprout": { "name": "<slug>.sproutportal", "script": "dev:bare" }`
  to `portless.json` **and** keep the per-app `portless` key in
  `workers/sprout/package.json` consistent — the package.json key **outranks** the
  root file (project memory `portless_name_in_package_json`). bouncer keeps the
  **bare** `sproutportal` name (`portless.json`); Sprout claims a brand-subdomain
  name so it resolves under `*.sproutportal.localhost` without colliding with
  bouncer's apex.
- **`vite.config.ts`** `allowedHosts` must cover the wildcard
  (`.sproutportal.localhost`) or dev requests are rejected
  (doc 03 directory tree comment; identity's `allowedHosts` precedent).

### 4.2 Staging (auto-deploy on green CI)

- **Topology**: bouncer is in front; the app is reached only via the bouncer
  service binding (`mode: passthrough`). `workers_dev: true` only at the top
  level (staging) of `workers/sprout/wrangler.jsonc` (`env.production` sets it
  `false`), so the staging
  worker also has a
  `sprout-sprout-staging.<workersDevSubdomain>.workers.dev` URL for direct smoke
  checks, where `<workersDevSubdomain>` is the account's workers.dev subdomain.
  The staging URL vars in each `wrangler.jsonc` embed `sproutcannabis`
  (confirmed on disk) — this is a value to **verify**, not a placeholder.
  Confirm via `wrangler whoami` / the CF
  dashboard that this is the fork account's actual `workers.dev` subdomain before
  relying on the direct-smoke URL; keep it unless the account differs (§9
  Prerequisites). The smoke step reads the value from `deploy.ts` rather than
  hardcoding it.
- **It deploys itself**: `.rwx/promote-staging.yml` runs as an embedded run from
  `.rwx/ci.yml` after the gate on every push to `main` (§5.1). No manual step.
- **`ENVIRONMENT=staging`**, `BNC_ATT_KID=dev` — staging signs envelopes with
  the **dev** attestation keypair (`packages/secrets/src/manifest.ts:142-146`,
  `ATT_KID.staging = "dev"`), so apps verify against the published dev public
  key. This is why `BNC_ATT_PRIV` is sourced from the committed dev default in
  staging (`packages/secrets/src/manifest.ts:157`).

### 4.3 Production (gated)

- **Topology**: bouncer in front; `BNC_ATT_KID=production`
  (`workers/bouncer/wrangler.jsonc:97`), so bouncer signs with a
  **unique** production Ed25519 keypair and apps verify against the production
  public key in `packages/config/src/bouncer-attestation.ts`. The envelope
  verifier is EdDSA-only and asserts non-empty keys in prod
  (per the envelope-verify contract).
- **Gated promotion** — production is not continuous: it ships on
  `.rwx/release-please.yml` when a Release PR is merged (§6). That merge is the
  gate; the run then applies `db:migrate:production` → leaf → apps → bouncer in
  canonical order and unlocks the same `greenroom_deploy` vault (§3.1).

### 4.4 Secrets per environment (via the secrets manifest)

`packages/secrets/src/manifest.ts` is the single source of truth: the CLI
(`bun run secrets <env>`), the `.dev.vars` writer, and the `wrangler secret put`
targeting all flow from it (`packages/secrets/src/manifest.ts:1-9`). To enroll
Sprout:

1. Add `"sprout"` to the `ServiceName` union
   (`packages/secrets/src/manifest.ts:16-23`) and to `SERVICE_DIR`
   (`packages/secrets/src/manifest.ts:26-34`, `sprout: "workers/sprout"`). The
   deployed worker name is computed as `<prefix>-sprout-<env>` by `workerName()`
   (`packages/secrets/src/manifest.ts:43-45`).
2. **`BNC_ATT_PRIV`** (Ed25519 dev signer) — `"sprout"` is in
   `BNC_ATT_PRIV.perEnv.local` (`packages/secrets/src/manifest.ts:98`, alongside
   `"bouncer"` and `"identity"`). Sprout self-mints dev envelopes in
   dev-direct topology, so it needs the dev signing key **locally**. It does
   **not** sign in staging/production (only bouncer does), so it is **not** added
   to the staging/production `perEnv` lists.
3. **`BETTER_AUTH_SECRET`** — **not** Sprout's. It is guestlist-only
   (`packages/secrets/src/manifest.ts:85`). Sprout reaches auth over the
   `GUESTLIST` binding; it never holds the auth signing secret.
4. **AI** — v1 uses the **Workers AI binding** path (default), so **no AI secret**
   is provisioned: the `AI` binding carries auth implicitly. The external-LLM path
   is a documented opt-in only — if ever chosen, add a **new** `SecretSpec` to
   `SECRETS` (`packages/secrets/src/manifest.ts:79-127`),
   `kind: { type: "provided" }`, `perEnv: { local: ["sprout"], staging:
["sprout"], production: ["sprout"] }`. Not added in v1.
5. **Email / blob / video** — Sprout needs **no** `RESEND_API_KEY` / `S3_*`
   secret: email goes through **promoter** over RPC
   (`packages/secrets/src/manifest.ts:101-122` scope those to promoter/roadie),
   blob storage through **roadie** over RPC. Booked/group-session room transport
   is **RealtimeKit** (settled, doc 05 §6), whose config splits by sensitivity:
   the **App id** (`RTK_APP_ID`, from `deploy.ts → rtk.{staging,production}`) and
   `CF_ACCOUNT_ID` are non-secret **wrangler `vars`** in the sprout `wrangler.jsonc` — NOT
   secrets; only the Realtime-scoped **`RTK_API_TOKEN`** is a `provided`
   `SecretSpec` scoped to `["sprout"]` (staging + production; no `local` — local
   dev is inert unless a dev app id + token are placed in `workers/sprout/.dev.vars`).
   Provision both with
   `bun scripts/provision-realtimekit.ts --env <env> --app-name sprout-<env>`.
   RealtimeKit managed recording egresses to the project R2 bucket (the same R2
   credentials roadie uses), so no extra storage secret is added to Sprout.

Provision with `bun run secrets staging` (and `production`), which reads the
manifest and runs `wrangler secret put` per (secret × env × service). Local
`.dev.vars` is written by the same tool from `DEV_DEFAULTS`
(`packages/secrets/src/manifest.ts:135-139`).

---

## 5. Deployment cadence

### 5.1 Trunk-based + continuous-deploy-to-staging (already wired)

- **CI (`.rwx/ci.yml`)** is the authoritative gate: install once, then **one task
  per package** — `typecheck-<pkg>` (`cd <pkg> && bun run typecheck`, its own
  `tsgo --noEmit`) and `test-<pkg>` (`captain run greenroom-<pkg>`) — each with a
  `filter` so RWX content-caches them independently (change only
  `workers/sprout/**` → just Sprout's two tasks re-run; change a shared
  `packages/*` or the lockfile → everything re-runs). Sprout is registered by its
  explicit `typecheck-sprout` + `test-sprout` task pair in the gate (already
  present), a `typecheck` script (`tsgo --noEmit`), and a Captain suite. Its
  `types` script composes its own `wrangler.jsonc` plus guestlist's:

  ```jsonc
  "types": "wrangler types -c ./wrangler.jsonc -c ../guestlist/wrangler.jsonc"
  ```

  (`AI`/`VECTORIZE`/`BROWSER` are same-worker bindings already in Sprout's own
  `wrangler.jsonc` and need no extra `-c`; the shipped script composes only
  guestlist's config, so keep it in sync with what Sprout actually binds.)

- **CD (`.rwx/promote-staging.yml`)** runs as an embedded run from `.rwx/ci.yml`
  **after** the gate, on push to `main` — so staging always tracks the tip of
  `main` that last passed the gate (RWX only ships a commit the same run proved
  green). The `greenroom/greenroom:deploy-staging` concurrency pool (capacity 1,
  `on-overflow: cancel-waiting`) serialises deploys so two merges can't race a
  half-deployed worker set.
- **Pre-commit / pre-push** via `.githooks/` (`core.hooksPath .githooks`, root
  `prepare` script). `scripts/staged-check.ts` runs `vp check --fix` on staged
  files **except** test/`scripts/` files, which get format-only — vp's per-file
  checker phantoms vitest/node globals (`scripts/staged-check.ts:6-12`). For
  Sprout commits that touch test files, `--no-verify` is the accepted escape
  hatch (CLAUDE.md); workspace-wide `bun run check` + `tsgo` remain the
  authoritative signal.

### 5.2 Promotion to production cadence

Production is **gated**, not continuous. It runs on `.rwx/release-please.yml`:
release-please (manifest mode, one component per worker) opens/updates a Release
PR from the conventional commits on `main`; merging that Release PR cuts the
per-worker component tags `<worker>-v<x.y.z>` and, **in the same run**, ships only
the released workers in canonical order (`db:migrate:production` → leaf → apps
incl. sprout → bouncer last, via `scripts/deploy-worker.sh`) followed by the apex
smoke test. Merging the Release PR **is** the production-ship decision — the
deliberate human gate that staging lacks (single-maintainer repo; no separate
reviewer approval). Staging burns in every green `main` commit automatically;
production ships a deliberate, released subset.

### 5.3 Per-phase rollout (ship sections dark behind brand-config toggles)

The product is delivered in phases P1–P7 (the spec's own plan). The single-app
architecture makes a **phased rollout a data toggle, not a deploy**: each Portal
section is gated by `portal_config.sections_json` (the per-brand section
checklist, doc 02 §1 `brandConfig`), so a section can be **built and deployed to
production while dark** for every brand, then lit per-brand from Brand Admin.

- **Feature-gate new sections at the section-layer boundary.** The shell reads
  the enabled-sections list and only renders a section card / allows its
  `?section=` layer to open when that key is enabled (doc 03 section-layer
  system). The six section keys are the **single canonical enum used 1:1 for both
  `live_sections_json` and the `?section=` param**: `assets | decks | quizzes |
feed | chat | contact`. A P3 Media Feed can land in the worker (the single
  `GroupChatRoom` DO class, server fns, tables migrated) with `feed` absent from
  every brand's `live_sections_json` — zero user-visible change — then flipped on
  per brand.
- **Draft → Live as the per-brand THEME release valve.** `brand_theme.state`
  (`draft | live`) and the `draft_*`/`live_*` JSON split (doc 02 §1) mean even a
  fully-built section ships behind a brand's own Flip-to-Live, independent of the
  platform deploy. The public portal reads only `live_*`; admin preview reads
  `draft_*`.
- **Sprout-platform feature flags** for cross-brand staged rollout (e.g. AI
  assistant for a pilot cohort) ride the same `portal_config` section-toggle
  layer rather than a build flag — keeping with "configuration, never code."

The net effect: trunk-based continuous deploy to staging on every green commit,
gated promotion to production, and **per-phase / per-brand visibility controlled
by data** — a section is dark in prod while built, then lit without a deploy.

### 5.4 Migration cadence

- Author schema in `workers/sprout/src/schema.ts`, `bun run db:generate`
  (drizzle-kit) → `migrations/NNNN_*.sql`, commit the generated SQL (never
  hand-edited except the two `reviews` CHECKs, doc 02). One PR carries the
  migration **and** the code that reads it; CD applies the migration before
  deploying the code (§2.1).
- Keep migrations **additive within a release** so code rollback stays safe
  (§2.3); stage destructive changes expand → migrate → contract across two
  releases.

### 5.5 Preview / PR strategy

- CI runs on every `pull_request` (`.rwx/ci.yml` github trigger) — the
  per-package typecheck + test gate the PR. Staging CD does **not** fire on PRs
  (it only runs on push to `main`), so a PR is verified but not deployed.
- **Per-PR preview deploys exist but are dark.** `.rwx/preview.yml` does a
  `wrangler versions upload` preview of the changed workers, but its PR trigger is
  **not yet enabled** (owner action — provision the `greenroom_preview` vault), so
  today the local `*.sproutportal.localhost` dev-direct flow (§4.1) **is** the
  per-branch preview. Once the vault lands and the trigger is uncommented,
  previews activate on their own and the staging lane begins **promoting** those
  uploaded versions instead of full-building (`.rwx/promote-staging.yml`).

---

## 6. The production lane

Production ships on RWX. Two lanes, both reusing `scripts/deploy-worker.sh` and
the canonical bouncer-last order:

- **`.rwx/release-please.yml`** — the automatic lane. release-please (manifest
  mode, one component per worker) opens a Release PR; merging it cuts the
  per-worker component tags `<worker>-v<x.y.z>` and, in the same run, ships only
  the released workers (`db:migrate:production` → leaf → apps incl. sprout →
  bouncer last) then runs the apex smoke test. Merging the Release PR **is** the
  ship decision — the deliberate human gate that staging lacks (single-maintainer
  repo; no separate reviewer approval).
- **`.rwx/release.yml`** — the manual escape hatch: `rwx dispatch reship-worker
--param worker=sprout --param tag=sprout-v<x.y.z>` re-ships (or rolls back) ONE
  worker at ONE already-cut tag.

Sprout needs **no new CI/CD file** — it enrols in both lanes the same way every
other worker does: a `sprout` release-please component (`release-please-config.json`

- `.release-please-manifest.json`) and its place in the canonical deploy order.

---

## 7. Observability

### 7.1 Canonical logging (kit)

Sprout installs the kit request + function loggers in `src/start.ts`, the same
pattern identity uses:

```ts
import { createLoggingFunctionMiddleware, createRequestLogger } from "@greenroom/kit/react-start";
const requestLogger = createRequestLogger({ service: "sprout" });
const functionLogger = createLoggingFunctionMiddleware({ service: "sprout" });
export default createStart(() => ({
  requestMiddleware: [requestLogger, envelopeMiddleware],
  functionMiddleware: [functionLogger],
}));
```

`service: "sprout"` tags every structured log line so the worker's logs are
filterable per app. `observability.enabled: true` (+ `head_sampling_rate: 1` and
`logs.enabled` in production) is in Sprout.s own `wrangler.jsonc` — Cloudflare
Workers Logs capture the structured output. The DO uses the same logging
surface; the queue/cron handlers (`jobs/queue.ts`, `jobs/cron.ts`) log under
the same service tag.

### 7.2 `analytics_events` + Analytics Engine

Two analytics sinks, both already in the data model and wrangler shape:

- **`AE` (Analytics Engine dataset `sprout_sprout_events`)** —
  write-mostly engagement telemetry (deck flip depth, session join duration,
  AI questions) written off the request path (doc 03 state/data-loading; the
  `AE` binding is declared in Sprout.s own `wrangler.jsonc`, §1.1).
- **`analytics_events` D1 table** — the append-only, `brand_id`-scoped event
  stream the Brand-Admin dashboards aggregate and CSV exports stream from
  (doc 02 §12). Never UPDATEd/DELETEd. The heavy rollups (leaderboard recompute,
  most-missed-question, award countdown) run in the **`queue`/`cron` jobs**
  (doc 03 `jobs/`), not on the request path — `handleCron`/`handleQueueBatch`
  exported at the worker entry (`workers/sprout/src/worker.ts`).

### 7.3 Error tracking

Worker exceptions surface through Cloudflare Workers observability
(`observability.enabled`), tagged by the `service: "sprout"` log context. The
envelope verifier's prod-reject path throws an `EnvelopeRejection` → 403 (the
envelope-verify contract), which the request logger records. The
discriminated-union policy decisions (`{ ok: false, reason }`, Sprout's own
`workers/sprout/src/lib/policy.server.ts`) give structured, loggable authz-denial
reasons rather than opaque throws. **Decision: rely on Cloudflare Workers
observability for v1; do not add Sentry.** The structured `service: "sprout"`
logs + the `EnvelopeRejection` → 403 path + the policy unions give loggable
failures without a third-party tracker (a new secret + dependency). Default —
add Sentry as a `provided` secret scoped to `["sprout"]` only if production
incident volume needs alerting/grouping.

### 7.4 Post-deploy smoke hook

Each RWX deploy lane runs the shared `scripts/smoke-test.sh <url>` as its final
step, **after** the bouncer deploy. It hits the public apex router (bouncer) at
`<url>` and requires a non-5xx answer: any status < 500 is healthy (a
200/301/302/307 to the identity sign-in is a healthy router); a 5xx or no
connection (`000`) fails the deploy. Because bouncer deploys **last** and the
smoke runs **after** it, a green smoke proves the whole chain (router → `SPROUT`
binding → guestlist/roadie/promoter bindings) answers, exercising the wildcard
route + the host→org→`brand_theme`/`portal_config` resolution path end-to-end; a failing smoke
flags a bad push for the next promotion gate to catch.

Deeper authenticated DO/envelope assertions — including the DO's `session.init`
frame (doc 05 §2.3) — live in the e2e Playwright suite (doc 06), not this
post-deploy probe. There is **no promoter smoke probe** (promoter is RPC-only
with no public surface); instead a build-time assertion verifies the `PROMOTER`
binding resolves in the `wrangler.jsonc`.

Because bouncer deploys **last** and the smoke runs **after** it, a green smoke
proves the whole chain (router → SPROUT binding → guestlist/roadie/promoter
bindings) is live. A failing smoke fails the deploy job (it is past the point of
no rollback, but it flags a bad staging push for the next promotion gate to
catch).

---

## 8. Registration checklist (deploy surfaces only)

Adding `workers/sprout` touches exactly these deploy/registration surfaces (doc 03
checklist, reconciled to this doc's wiring). **`sprout` is the single frozen name
across every surface below** (dir `workers/sprout`, worker `sprout-sprout`, token
`D1_SPROUT`, binding `SPROUT`, URL var `SPROUT_URL`, package name
`@greenroom/sprout-app`, roadie `caller_app: "sprout"`):

1. `workers/sprout/vite.config.ts` — a `db:migrate:local` vp task (`wrangler d1 migrations apply DB --local`) so `bun run migrate` / `bun run dev` apply Sprout's local migrations (§4.1).
2. `workers/sprout/wrangler.jsonc` — the `DB` D1 binding with its `database_id` (staging at top level, prod in `env.production` — §1.2), the single `GroupChatRoom` DO + `v1` migration tag (`new_sqlite_classes: ["GroupChatRoom"]`, binding `GROUP_CHAT_ROOM`), `SPROUT_JOBS_QUEUE`, `AE`, GUESTLIST/ROADIE/PROMOTER service bindings, and the **three new bindings** `AI` + `VECTORIZE` + `BROWSER` (Browser Rendering — all NEW, none exist in greenroom today), repeated per env (§1.1).
3. `workers/sprout/package.json` — package name `@greenroom/sprout-app`; `db:migrate:staging`/`db:migrate:production` scripts (§2.1); the `types` script composing Sprout's own `wrangler.jsonc` + guestlist's (§5.1); per-app `portless` key (§4.1).
4. `workers/bouncer/wrangler.jsonc` — `SPROUT` service binding + wildcard `*.sproutportal.ca` route + apex, in the top-level (staging) and `env.production` blocks (§1.3).
5. `packages/secrets/src/manifest.ts` — `ServiceName` + `SERVICE_DIR` + `BNC_ATT_PRIV.perEnv.local` + the RealtimeKit app id/secret `provided` SecretSpec scoped to `["sprout"]` (§4.4). **No AI secret** in v1 (binding path).
6. `portless.json` — add `workers/sprout` (§4.1).
7. `.rwx/ci.yml` — the `typecheck-sprout` + `test-sprout` gate task pair (each with a `workers/sprout/**` filter), already present (§5.1).
8. `scripts/changed-workers.sh` `ORDER` + `.rwx/deploy.yml` — `sprout` in the canonical deploy order (before bouncer) so the staging (`.rwx/promote-staging.yml`) and production lanes ship it in order; **no new deploy workflow** (§3, §6).
9. `release-please-config.json` + `.release-please-manifest.json` — register `workers/sprout` as a release-please component so a Release-PR merge cuts its `sprout-v*` tag and ships it in the released subset (§6).

---

## 9. Decisions & implementation prerequisites

All previously-open deploy questions are now **decided**. The decisions are
recorded inline above; this section is the index, followed by the concrete
provisioning prerequisites a builder must complete before the corresponding band
of the deploy works.

### 9.1 Settled decisions (index)

- **Name** — frozen as `sprout` (§ Naming note, §8). Dir `workers/sprout`, worker
  `sprout-sprout`, token `D1_SPROUT`, binding `SPROUT`, URL var `SPROUT_URL`,
  package `@greenroom/sprout-app`, roadie `caller_app: "sprout"`. **Not**
  `portal`/`PORTAL`. The `sprout-sprout` doubling is cosmetic and deploy-internal.
- **portless name** — bouncer keeps the bare `sproutportal` name; Sprout's brand
  subdomains resolve under `*.sproutportal.localhost` via the per-app `portless`
  key (which outranks the root file). No collision (§4.1).
- **AI** — Workers AI **binding** path (default), generation
  `@cf/meta/llama-3.1-8b-instruct`, embeddings `@cf/baai/bge-base-en-v1.5`
  (768-dim). **No AI secret in v1**; external LLM is a one-file `generate()`-seam
  opt-in, not provisioned (§1.1, §4.4).
- **DO class set** — **one** class `GroupChatRoom` (binding `GROUP_CHAT_ROOM`);
  `v1` frozen at `new_sqlite_classes: ["GroupChatRoom"]`, addressed per-room via
  `idFromName` (brand chat = `idFromName(brandId)`, feed comments =
  `idFromName(\`${brandId}:${postId}\`)`). `MediaFeedRoom`is a future`tag: "v2"`
  escape hatch only (§1.1, §2.2).
- **`workers.dev` subdomain** — the staging URL vars in each `wrangler.jsonc`
  embed `sproutcannabis` (confirmed on disk); a value to verify, not a placeholder
  (§4.2, §7.4).
- **`*.sproutportal.ca` wildcard** — a single wildcard custom-domain route on the
  bouncer worker backed by a **zone wildcard TLS cert** (ACM / Total TLS), **not**
  Cloudflare for SaaS (§1.3).
- **Production lane** — `.rwx/release-please.yml`: merging the release-please
  Release PR cuts the per-worker `<worker>-v*` tags and, in the same run, ships
  the released subset (`db:migrate:production` → leaf → apps incl. sprout →
  bouncer) then smoke-tests the apex. The merge is the gate; manual re-ship is
  `.rwx/release.yml` (§5.2, §6).
- **Per-worker remote migrate** — Sprout carries its own
  `db:migrate:staging`/`db:migrate:production` scripts, run before its code by
  `scripts/deploy-worker.sh ship`; **no backfill needed** for chat/quiz (already
  folded into Sprout) and `marketing` has no remote D1 (§2.1, §3.2).
- **PR preview deploys** — `.rwx/preview.yml` exists but its PR trigger is dark
  until the `greenroom_preview` vault lands; the local
  `*.sproutportal.localhost` dev-direct flow is the per-branch preview (§5.5).
- **Error tracking** — Cloudflare Workers observability for v1; **no Sentry**
  (§7.3).
- **Roadie blob backfill** — greenfield forks = **no-op** (all blobs minted under
  `caller_app: "sprout"` from the skeleton); a data-carrying fork runs the
  one-time re-register-under-`sprout` backfill (P2.D quiz / P3 chat) — gated on the
  prerequisite below.

### 9.2 Implementation prerequisites (provisioning, before non-local deploy)

These are concrete provisioning tasks, not design unknowns:

1. **Cloudflare account** — set `cloudflareAccountId` in
   `packages/config/src/deploy.ts` (currently `TODO-replace-with-your-cf-account-id`,
   confirmed on disk).
2. **Sprout D1** — `wrangler d1 create sprout` for staging/production, paste
   the UUIDs into the `database_id` fields of the sprout `wrangler.jsonc` (top
   level = staging, `env.production` = prod) (§1.2).
3. **Roadie D1** — roadie's staging/production `database_id`s live directly in
   `workers/roadie/wrangler.jsonc` (top level = staging, `env.production` = prod;
   there is no `deploy.ts` `d1` field) and are already populated with the
   provisioned UUIDs.
4. **Wildcard domain** — add `sproutportal.ca` as a Cloudflare zone, order/enable a
   `*.sproutportal.ca` Advanced/wildcard TLS cert (Total TLS or ACM), and confirm
   the wildcard `custom_domain` route binds on the bouncer worker before the first
   staging brand subdomain (§1.3).
5. **Roadie R2** — provision roadie's R2 bucket + S3/SigV4 credentials (the `S3_*`
   roadie secrets) before any non-local roadie upload/serve.
6. **Browser Rendering** — enable the Browser Rendering binding on the account and
   add it (`binding BROWSER`) to the sprout `wrangler.jsonc` alongside `AI`/`VECTORIZE`
   (§1.1).
7. **Vectorize index** — create the index with **dimension 768** (matching
   `@cf/baai/bge-base-en-v1.5`) and a `brand_id` metadata filter (§1.1).
8. **RealtimeKit** — create the app, capture app id + secret, add them as
   `provided` wrangler secrets scoped to `["sprout"]` for all envs, and configure
   managed recording's S3-compatible output to target the project R2 bucket
   (§4.4).
9. **`workers.dev` subdomain** — confirm via `wrangler whoami` / the CF dashboard
   that `deploy.ts:25` `workersDevSubdomain` (`sproutcannabis`) is the fork
   account's actual subdomain; update `deploy.ts` only if it differs (§4.2).
10. **Guestlist org-hook emitter** — build the better-auth org `databaseHook` →
    RPC call to Sprout's `syncOrgDirectory` if guestlist exposes no usable hook
    surface yet; until it lands, run `org_brand_directory` sync **cron-only at
    5-min cadence** and accept up to ~5 min onboarding latency.
11. **Production lane enrolment** — no new CI file: register `sprout` as a
    release-please component (`release-please-config.json` +
    `.release-please-manifest.json`) and keep it in the canonical deploy order
    (`scripts/changed-workers.sh` `ORDER`, before bouncer), so
    `.rwx/release-please.yml` ships it on a Release-PR merge (§6).
12. **Fork data audit** — confirm whether any target fork carries existing
    quiz/chat production rows; if all greenfield, the roadie re-reference backfill
    and the chat/quiz staging-migrate backfill are no-ops; if a data-carrying fork
    exists, schedule the backfill as a P2.D (quiz) / P3 (chat) task (§3.2).
13. **Shared demo constants** — add the brand/budtender identity constants for the
    two demo brands to a single `workers/sprout/__tests__/demo-constants.ts` imported
    by both `__tests__/fixtures.ts` and `scripts/seed.ts` so names never drift
    (smoke/seed reconcile, doc 06).
