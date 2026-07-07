# RWX activation runbook

**Status: the CI/CD in `.rwx/` is SCAFFOLDING-ONLY until every step below is
done.** The lanes were re-homed from the greenroom template and sanity-checked
structurally (YAML parses, scripts self-test, shared mechanics exercised
locally), but none of them has run against the live RWX backend for
`apostolos-geyer/somewhatintelligent` — no RWX app installation, no vaults, no
tokens exist yet. Until then, pushes and PRs trigger nothing; treat every lane
as unverified.

The lane semantics themselves are unchanged from the template and documented
in place: PR → verify gate (`.rwx/ci.yml`), push-to-main → gate then
changed-subset staging promote (`.rwx/promote-staging.yml`), release-please →
per-worker production deploys (`.rwx/release-please.yml`), manual single-worker
reship (`.rwx/release.yml`), per-PR previews (`.rwx/preview.yml`), and the
env-parameterized full-fleet reference (`.rwx/deploy.yml`).

> **The vendored inbox app (`inbox/`) is deliberately outside all of this.**
> It deploys manually — `cd inbox && bun run deploy` — outside RWX, has no
> release-please component, and `inbox/**` changes are a no-op for every lane
> (`scripts/changed-workers.sh`). Owner decision.

## 1. Install the RWX GitHub App

1. Sign in at <https://cloud.rwx.com> and create a **dedicated RWX
   organization for this platform** (owner decision 2026-07-07: do NOT reuse
   the `greenroom` org — vaults, GitHub App installations, and access tokens
   are all org-scoped, so a shared org would put this fork's deploy secrets
   inside the template org's blast radius). Every step below happens inside
   the new org; the CLI needs a token minted under it (`rwx login`).

   > **Interim state (2026-07-07):** the dedicated `somewhatintelligent` org
   > was created but its trial-credit verification was broken on RWX's side,
   > so the lanes currently run under **`greenroom`** — both vaults +
   > secrets exist there (and, dormant, in the `somewhatintelligent` org),
   > and the RWX GitHub App installation covers this repo. Nothing in
   > `.rwx/*.yml` references an org name, so migrating later is purely
   > account-side: reinstall the GitHub App under the new org, recreate the
   > two vaults there (steps 2–3), re-attach the automation GitHub App.

2. Install the RWX GitHub App on **apostolos-geyer/somewhatintelligent**
   (Getting Started → GitHub integration). This is what makes `github.token`
   resolve in the lanes (clone + status checks) and turns on the `github:`
   triggers in `.rwx/*.yml`.
3. Create the **automation GitHub App entry** named
   `rwx-automation-si` (RWX → Vaults → GitHub Apps), pointed
   at this repo, with these repository permissions:
   - `deployments: write` — fleet + per-worker GitHub Deployment records
     (`scripts/rwx-github-deployment.sh`)
   - `contents: write` — release-please (tags + release PR branches)
   - `pull-requests: write` — release-please's Release PR **and** the
     per-deploy summary comment (`gh_deploy_summary_comment`)
   - optional `issues: write` — lets `.rwx/preview.yml` post the sticky
     preview comment (`scripts/pr-preview-comment.sh` degrades to
     run-links-only without it)

## 2. Mint the Cloudflare tokens

The provisioning suite mints them from a master token
([`docs/ops/provisioning.md`](provisioning.md)):

```sh
export CLOUDFLARE_API_TOKEN=<master token>   # bootstrapping-only credential
bun scripts/provision/tokens.ts --dry-run     # inspect the plan
bun scripts/provision/tokens.ts               # writes .provision/tokens/*.json
```

This yields (account `c735c5a53d864bee37400befb7f4c7f4`):

| Token        | Scopes                                                                                          | Used by                                                    |
| ------------ | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `si-deploy`  | Workers Scripts Write, D1 Write, Workers Routes Write, DNS Write (zone), SSL/Certs Write (zone) | every deploy lane (staging + production, same token)       |
| `si-preview` | Workers Scripts Write, Account Settings Read                                                    | `.rwx/preview.yml` version uploads only (no D1/DNS/routes) |

Both MUST be minted **from this fork's Cloudflare account** — a
foreign-account token throws D1 7403-class errors on the first migration.

## 3. Create the vaults

```sh
# Locked deploy vault — restrict to the `main` branch under
# Vaults -> si_deploy -> Access Control BEFORE putting secrets in it.
rwx vaults create --name si_deploy
rwx vaults secrets set --vault si_deploy \
  CLOUDFLARE_API_TOKEN=<the minted si-deploy token> \
  CLOUDFLARE_ACCOUNT_ID=c735c5a53d864bee37400befb7f4c7f4
# Attach the GitHub App token to the same vault:
#   Vaults -> si_deploy -> GitHub Apps -> rwx-automation-si

# Unlocked preview vault — any branch may upload 0%-traffic versions;
# acceptable for this single-maintainer private repo because the token can
# do nothing else.
rwx vaults create --name si_preview --unlocked
rwx vaults secrets set --vault si_preview \
  CLOUDFLARE_API_TOKEN_PREVIEW=<the minted si-preview token>
```

Vault/App names are load-bearing: the lanes reference
`vaults.si_deploy.secrets.*`,
`vaults.si_deploy.github-apps.rwx-automation-si.token`, and
`vaults.si_preview.secrets.CLOUDFLARE_API_TOKEN_PREVIEW` literally.

## 4. Verify, lane by lane

Do these IN ORDER — each later lane assumes the earlier ones proved out.
`rwx lint .rwx/*.yml` first; it needs only `rwx login`, no vaults.

1. **Gate (`.rwx/ci.yml`)** — open a draft PR with a trivial worker change.
   Expect: `pr-title-lint` + per-package typecheck/test tasks + `gate` green;
   NO deploy tasks fire (`init.deploy` is false on PRs). Also expect a
   preview run (below) since the PR trigger is live once the app is installed.
2. **Previews (`.rwx/preview.yml`)** — on that same PR, expect one
   `upload-<worker>` task per changed worker, preview URLs in the run's links
   panel, and (with `issues: write`) the sticky PR comment. CLI rerun:
   `rwx run .rwx/preview.yml --init pr-number=<N>`.
3. **Full-fleet staging reference (`.rwx/deploy.yml`)** — validate the deploy
   path directly BEFORE trusting the embedded call from ci.yml (the embedded
   `call:` + locked-vault interaction documented in deploy.yml's header is
   still unverified on this fork):
   `rwx run .rwx/deploy.yml --init env=staging --init deploy=true --init commit-sha=<a real main sha>`
   Expect: D1 migrations (guestlist, roadie) → canonical-order deploys
   (promoter roadie guestlist identity store bouncer) → smoke test against
   <https://staging.somewhatintelligent.ca> → GitHub Deployments: one fleet
   record (`staging`) + one per worker (`staging/<worker>`, each with the CF
   dashboard link and live URL) + the compact summary comment on the commit.
4. **Promote lane (merge to main)** — merge the draft PR. Expect ci.yml's
   gate, then `deploy-staging` calling promote-staging.yml: ONLY the changed
   workers ship (promoted from the PR-uploaded version when eligible), same
   per-worker GitHub Deployment records + summary comment on the PR.
5. **release-please (`.rwx/release-please.yml`)** — after a `feat(<worker>):`
   merge, expect the Release PR to open/update. Merging it must cut
   `<worker>-v*` tags + GitHub Releases, then deploy ONLY the released
   workers to production, in canonical order, with per-worker
   `production/<worker>` Deployment records, and smoke-test
   <https://somewhatintelligent.ca>. §B.5(a)–(e) in that file's header is the
   full first-release checklist.
6. **Reship (`.rwx/release.yml`)** —
   `rwx dispatch si-reship-worker --param worker=<name> --param tag=<worker>-v<x.y.z>`
   re-ships one worker at an already-cut tag.

## Known scaffolding caveats (inherited, still unverified on this fork)

- `.rwx/deploy.yml`'s two embedded-run assumptions (locked-vault resolution +
  `github.token` inside an embedded run) — failure mode is loud, see its
  header.
- The workers.dev live-URL in per-worker deploy records is emitted for every
  service worker but only resolves where that worker's `wrangler.jsonc` has
  `workers_dev: true`.
- `workers/store` entries (gate tasks, captain suite `si-store`, deploy
  order, release-please component) reference the worker the storefront track
  ships; until it exists on the merged branch those tasks fail loudly.
