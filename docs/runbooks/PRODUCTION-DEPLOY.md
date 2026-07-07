# Runbook — Production deployment

How a change gets to **production** on Cloudflare, how to re-ship a single
worker, the deploy order and why, and the infra that must exist first. Staging
is continuous (every push to `main` via `.rwx/ci.yml`); **production is
release-gated** — you merge a Release PR and that same RWX run ships the workers
it just tagged.

- **Release + production deploy (one lane):** `.rwx/release-please.yml` — runs
  release-please on every push to `main`, and on a Release-PR merge cuts the
  per-worker tags and deploys the released subset.
- **Manual re-ship / rollback:** `.rwx/release.yml` — the `reship-worker`
  dispatch: one worker, one already-cut tag, on demand.
- **Per-worker mechanics:** `scripts/deploy-worker.sh` (`ship` = migrate then
  deploy) + `scripts/smoke-test.sh` — shared by every deploy lane.
- **Full-fleet reference / disaster lever:** `.rwx/deploy.yml` — the
  env-parameterized `migrate → ordered deploy` graph (staging runs through it;
  it's also the manual all-workers escape hatch).
- **Secrets:** `docs/runbooks/SECRETS.md` (`bun run secrets <env>`).

---

## 1. How a production release works today

release-please runs in **manifest mode**: one component per worker
(`release-please-config.json`), so a single Release PR groups version bumps for
every changed worker and, on merge, cuts **per-worker tags**
`<worker>-v<x.y.z>` (e.g. `guestlist-v0.2.2`). All seven workers currently sit
at `0.2.1` in `.release-please-manifest.json`.

```
conventional commits on main
        │  (.rwx/release-please.yml, on every push to main)
        ▼
release-please-pr → opens/updates the grouped "Release PR"
        │            (version bumps + CHANGELOG per changed worker)
        │  (you review + merge the Release PR — that IS the ship decision)
        ▼
release-please-github-release → cuts <worker>-v<x.y.z> tags + GitHub Releases
        │                        for every worker that changed
        ▼
released-components → reads back which workers have a <worker>-v* tag pointing
        │              AT the release commit (GitHub git-refs API, strongly
        │              consistent, keyed to the trigger SHA)
        ▼
deploy-production → clones the release commit, ships ONLY the released subset
                    in canonical order (migrate-before-code per worker), then
                    the apex smoke test against https://somewhatintelligent.ca
```

All four phases run in the **same** RWX run, so a Release-PR merge that touches
several workers still deploys them once, in one ordered pass — no per-tag race.
Phases 3–4 are gated: a normal feature push refreshes the Release PR (phase 1),
cuts no tags (phase 2 no-ops), derives an empty released set, and does zero
deploy work.

**To ship a release:**

1. Land your conventional-commit PRs on `main` (`feat:`, `fix:`, `perf:`,
   `ci:`, …). Each push refreshes the open Release PR.
2. When ready to cut a version, **merge the Release PR**. Watch
   `.rwx/release-please.yml` in the RWX UI: it cuts the per-worker tags, then
   `deploy-production` ships the released subset and posts a GitHub Deployment
   under the repo's **production** environment (`https://somewhatintelligent.ca`),
   finishing with the smoke test. That's it — no second command.

Merging the Release PR is the approval. This is a single-maintainer repo where
only the owner merges Release PRs, so a second sign-off after the merge would be
the same person approving their own decision twice — the merge (review the
version bumps + changelog, click merge) is the ship decision.

If a bad deploy ships, roll back by re-shipping a known-good tag (section 2) or
`wrangler rollback` per worker.

---

## 2. Re-ship (or roll back) a single worker

`.rwx/release.yml` is the manual escape hatch: deploy **one** worker at **one**
already-cut component tag. Dispatch it from the RWX UI or CLI:

```sh
rwx dispatch reship-worker --param worker=guestlist --param tag=guestlist-v0.2.1
```

- `worker` is a dropdown of the seven deployable workers (`promoter`, `roadie`,
  `guestlist`, `identity`, `marketing`, `sprout`, `bouncer`).
- `tag` is the **component** tag to deploy — `<worker>-v<x.y.z>`, e.g.
  `guestlist-v0.2.1`. The run clones that tag's commit. (Plain `v0.2.1` won't
  resolve; tags are per-worker now.)

It runs that worker's D1 migration first (if it has one), deploys, then the same
apex smoke test as the fleet deploy. Dispatching is the approval — naming the
worker and tag is the production-ship decision; there's no second gate.

The dispatch clones the tag's commit but unlocks the `greenroom_deploy` vault on
the default `main` ref, so the main-locked vault resolves normally. (Single
maintainer, so param-supplied refs are fine; if this repo ever gains
collaborators, switch to `--ref <tag>` + cloning `event.git.sha`.)

---

## 3. Deploy order — what runs, and why

Both the auto-deploy (`release-please.yml` phase 4) and the full-fleet reference
(`.rwx/deploy.yml`) ship workers in **true dependency order**, derived from each
service/app's `services` (binding) block in its `wrangler.jsonc` — not just
"leaf services then apps":

```
promoter, roadie → guestlist → identity → marketing → sprout → bouncer
```

- **promoter, roadie** — no service bindings (true leaves), go first.
- **guestlist** — binds `promoter` + `roadie`, so it must come **after** both.
- **identity** — binds only `guestlist`.
- **sprout** — binds `guestlist` + `roadie` + `promoter`.
- **bouncer** — the public router, binds `guestlist` + `identity` + `sprout`, so
  it ships **last**, only ever pointing at already-deployed upstreams.
- **marketing** — no bindings; position doesn't matter.

**Why the order is load-bearing (not cosmetic):** `wrangler deploy` fails with
Cloudflare API code **`10143`** — `Service binding 'X' references Worker 'Y'
which was not found` — if a worker deploys before a Worker it binds exists. This
bit the first production deploy for real: the order deployed `guestlist` before
`promoter`/`roadie` existed on the account, and wrangler refused. The order
above is the fix and is a permanent constraint — any new binding must respect
it.

D1 migrations run **before** code (schema before a worker can read it). The
three D1-backed workers are `guestlist`, `roadie`, `sprout`. In the per-worker
lanes (`release-please.yml`, `release.yml`) each worker migrates-then-deploys
atomically via `scripts/deploy-worker.sh ship`; in the full-fleet `deploy.yml`,
all migrations run first, then all deploys. Either way a migration failure is
fatal (no `|| true`) and aborts the deploy.

The post-deploy smoke test (`scripts/smoke-test.sh`) hits the public bouncer
router at the production apex and requires it to answer `<500` (a 200/redirect
to sign-in is healthy), retrying 5×; a 5xx or no-connection fails the run.

---

## 4. Infra prerequisites checklist

Run every `wrangler` / provisioning command against **this fork's Cloudflare
account** (`c735c5a53d864bee37400befb7f4c7f4`). Production and
staging share one account — environments are `--env production` suffixes, not a
second account. The wrangler `production` env blocks are already templated for
every service/app; the items below are hard blockers — `wrangler deploy --env
production` fails fast without them.

**The deploy token (in the `greenroom_deploy` vault) must be minted _from_
this account.** A token minted from any other account authenticates for
Workers but **D1 returns `7403`** (mismatched account) — migrations fail even
though the deploy looks authorized. It needs **Workers Scripts → Edit** + **D1 →
Edit**, account-scoped to this fork's account.

Per-environment resources that must exist on the account:

| Resource                                                 | For        | Provision                                                                                                       |
| -------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------- |
| `roadie-production-db`, `guestlist-production-db` D1 dbs | migrations | `wrangler d1 create <name>` → paste UUID into that worker's `wrangler.jsonc` `env.production` → `bun run types` |

**Production secrets** land on **deployed** workers, so provision them **after**
the first `deploy-production`:

```sh
CLOUDFLARE_ACCOUNT_ID=c735c5a53d864bee37400befb7f4c7f4 bun run secrets production
```

- `BETTER_AUTH_SECRET` (guestlist) and `BNC_ATT_PRIV` (bouncer) are **generated**
  — the CLI mints them into gitignored `.secrets/production.env`. `BNC_ATT_PRIV`
  is an Ed25519 keypair: its public half is written into
  `packages/config/src/bouncer-attestation.ts` (kid `production`) — **review,
  commit that pubkey, and redeploy guestlist** so verifiers carry it.
- `RTK_API_TOKEN` (sprout), `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (roadie),
  and the OAuth `*_CLIENT_*` (guestlist) are **provided** — pasted into
  `.secrets/production.env`, never committed. They're optional: the deploy
  succeeds without them, but the paired feature (in-platform calls / blob
  storage / that OAuth provider) stays inert until set. `RESEND_API_KEY` is not
  needed in production — email goes through the Cloudflare Email binding.

See `docs/runbooks/SECRETS.md` and `docs/ops/env-vars.md` for the full contract.

---

## 5. Gotchas that remain

- **Leaf-only release smoke coverage.** The smoke test only exercises the public
  apex router (bouncer). A release that ships **only** a leaf worker (e.g.
  `promoter` or `roadie`, with bouncer unchanged) is smoke-tested via the
  un-redeployed router — it proves the router still answers `<500` but gives
  near-zero signal on the freshly-shipped leaf. Conscious tradeoff; if leaf-only
  releases ever need real post-deploy coverage, add a per-worker health surface.

- **A release commit that cuts no tags fails loud.** If a Release-PR merge is
  detected (`is-release-commit`) but `released-components` reads back no
  `<worker>-v*` tags pointing at that commit, `deploy-production` **fails**
  rather than silently shipping nothing — that's a partial tag-cut to
  investigate (re-run `.rwx/release-please.yml`; `github-release` is idempotent
  and self-heals), not a no-op.

- **release-please's pool must never drop a trigger.**
  `.rwx/release-please.yml`'s `release-please` pool uses `on-overflow: queue`
  (capacity 1) — every push to `main` must eventually run, since any one of them
  may be the push that detects a just-merged Release PR. Do **not** switch it to
  `cancel-waiting`. The deploy-side pools (`deploy.yml`, `release.yml`) correctly
  use `cancel-waiting` — there, dropping a stale queued deploy in favor of the
  newest is right.
