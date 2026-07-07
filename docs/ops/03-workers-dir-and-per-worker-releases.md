# Spec 03 — `workers/` directory + per-worker release-please tags + released-subset deploys

> **Status**: ✅ IMPLEMENTED 2026-07-05/06. Part A (move) commit `641f6ea`
> (RWX gate green `3da52b30`); Part B (releases) commit `ba01781`. Notable:
> released-set derivation ships as a GitHub git-refs API read anchored to the
> TRIGGER sha (race-immune vs tag writes and mid-run HEAD advancement), with
> annotated-tag dereference, a 2000-tag pagination cap, and a loud empty-set
> fail-safe on release commits; both production lanes share the
> `greenroom/greenroom:production` queue pool; per-worker deploy mechanics
> extracted to `scripts/deploy-worker.sh` + `scripts/smoke-test.sh` (one copy,
> three lanes). Worker package.json versions aligned to 0.2.1 (identity/sprout
> had none — the extra-files bump would have silently no-opped).
> First-real-release verification (§B.5) remains outstanding by nature.
> **Depends on**: Spec 02 (fewer files to move; static configs make the sweep
> simpler). Spec 01 should be landed or its filter paths get updated here anyway.
> **Semantic change**: per-worker releases change WHEN a shared-package fix
> reaches production — read §B.4 and confirm the ride-out policy is acceptable.

## Part A — move `apps/*` + `services/*` → `workers/*`

### A.1 Scope

Deployable units all become `workers/<name>`: bouncer, guestlist, promoter,
roadie, identity, marketing, sprout. `packages/*` (shared libs), `e2e/`,
`scripts/` stay put. Package NAMES (`@greenroom/*`) do not change — only
directories; imports via workspace symlinks are unaffected. Use `git mv` per
directory (one commit for the moves, separate commits for reference sweeps —
keeps `git log --follow` clean).

`apps/chat` and `apps/quiz` are NOT part of the move: verified
**fully untracked** (`git ls-files apps/chat apps/quiz` → 0 files) — local
debris only (stale `wrangler.jsonc`, `dist/`, `node_modules/`; no
`package.json`, not workspaces). `rm -rf` them locally as part of this
session; nothing lands in git. (They already misled two research passes into
thinking they were live apps — exactly the stale-artifact hazard repo memory
warns about.)

### A.2 Verified path-reference inventory (the sweep list)

Everything that hardcodes `apps/` or `services/` paths (grep-verified):

| file                                                              | what to change                                                                                                                                                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (root)                                             | `workspaces`: `["workers/*", "packages/*"]` (drop `apps/*`, `services/*`)                                                                                                  |
| `portless.json`                                                   | app dir keys (`services/bouncer` → `workers/bouncer`, etc.)                                                                                                                |
| `.captain/config.yml`                                             | every `--root apps/…`/`--root services/…` (main + retry commands)                                                                                                          |
| `.rwx/ci.yml`                                                     | `gate-filter` alias entries, every per-task `filter` glob, `cd` paths in run commands                                                                                      |
| `.rwx/deploy.yml`                                                 | `cd services/…`/`cd apps/…` in `migrate` + `deploy` tasks                                                                                                                  |
| `scripts/apply-migrations.ts`                                     | `D1_PACKAGES` dirs                                                                                                                                                         |
| `scripts/dev-config.ts`                                           | label strings/comments only (no functional paths)                                                                                                                          |
| `e2e/sprout/helpers.ts`                                           | path reference (inspect and update)                                                                                                                                        |
| `fallow.toml`                                                     | path references                                                                                                                                                            |
| per-worker `package.json` `types` scripts                         | relative `-c` paths: siblings that were already siblings stay `../<name>`; `apps/sprout`'s `../../services/guestlist/wrangler.jsonc` becomes `../guestlist/wrangler.jsonc` |
| per-worker `scripts/bootstrap.ts` (or post-Spec-05 `env-init.ts`) | `../../../scripts/dev-config` import depth is UNCHANGED (`workers/<n>/scripts/` is still 3 deep) — verify, don't edit blindly                                              |
| `CLAUDE.md`, `README.md`, `docs/**`                               | textual references (large sweep; includes `apps/identity/src/app-brand.ts` mentions, runbooks, sprout docs)                                                                |
| `release-please-config.json` + manifest                           | Part B rewrites these anyway                                                                                                                                               |

Post-sweep guard: `git grep -nE '(apps|services)/(bouncer|guestlist|promoter|roadie|identity|marketing|sprout)'`
must return only CHANGELOG/history files. Also re-run the vite/vitest configs
grep for `../../` cross-package relative paths inside `workers/*` (e.g. vitest
`--outputFile=../../.captain-out/...` in `.captain/config.yml` retry commands —
depth from `workers/<n>` is unchanged, but verify each).

### A.3 Verification (Part A)

Full local tiers: `bun install && bun run types && bun run typecheck &&
bun run test` + `test:pool`; boot the dev stack (portless trio) and load the
portal; then `rwx run .rwx/ci.yml --wait` green. Expect ALL RWX gate tasks to
cache-MISS once (paths moved = new content hashes) — that's a one-time full
re-run, not a regression.

## Part B — per-worker release-please + released-subset production deploys

### B.1 Current state

Single-version repo releases: `release-please-config.json` has one package
`"."`, `include-component-in-tag: false` → tags `v0.2.1`, `v0.2.0`, `v0.1.1`.
release-please runs as the **CLI on RWX** (`.rwx/release-please.yml`, two
tasks: `release-pr` then `github-release`), NOT the GitHub Action — so the
Action's `paths_released` / per-path outputs are unavailable to us.
`.rwx/release.yml` fires on `refs/tags/v*` and full-fleet deploys production in
the canonical binding order (promoter, roadie → guestlist → identity →
marketing → sprout → bouncer LAST; order exists because of real error-10143
binding failures).

### B.2 Target release-please config

Manifest mode, one package per worker, `simple` release type (workers are not
npm-published; `simple` = changelog + version + tag, with `extra-files` still
stamping each worker's `package.json` version). Component tags:
`<component>-v<version>` (e.g. `guestlist-v1.2.0`).

`release-please-config.json`:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "release-type": "simple",
  "include-component-in-tag": true,
  "include-v-in-tag": true,
  "tag-separator": "-",
  "separate-pull-requests": false,
  "group-pull-request-title-pattern": "chore: release ${branch}",
  "changelog-sections": [ …keep existing… ],
  "packages": {
    "workers/bouncer":   { "component": "bouncer",   "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/guestlist": { "component": "guestlist", "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/promoter":  { "component": "promoter",  "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/roadie":    { "component": "roadie",    "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/identity":  { "component": "identity",  "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/marketing": { "component": "marketing", "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] },
    "workers/sprout":    { "component": "sprout",    "extra-files": [{ "type": "json", "path": "package.json", "jsonpath": "$.version" }] }
  }
}
```

`.release-please-manifest.json`: one entry per path, seeded at each worker's
starting version (recommend: all `"0.2.1"`, continuing today's line). Set
top-level `bootstrap-sha` to the migration commit so the first per-worker run
doesn't changelog all history.

Gotchas (documented upstream, cited in §B.6):

- Set `component` explicitly on every package (with `simple` there's no
  package-name inference; empty components cause "Multiple paths for :" errors).
- Keep components FLAT (`guestlist`, not `services/guestlist`) — slashes in
  components pollute tags.
- One combined Release PR (`separate-pull-requests: false`) is right at this
  worker count; its title pattern must stay `chore: release ${branch}` because
  `.rwx/ci.yml`'s `is-release-commit` skip matches
  `starts-with(message, 'chore: release ')` — verify that string survives.
- Root `package.json` version + root `CHANGELOG.md` stop being release-managed
  (the `"."` package is gone). Leave them frozen or delete the root CHANGELOG
  pointer — owner's call, note it in the PR.

### B.3 Deploy wiring — one ordered deploy of the released subset

Per-tag independent deploy runs are WRONG here: several workers can release
from one Release-PR merge, and deploy order must stay canonical (bouncer last).
So: fold production deploys into the release-please run and derive the released
set from tags on the release commit (no Action outputs needed):

1. In `.rwx/release-please.yml`, after `release-please-github-release`, a task
   computes the released components:

   ```sh
   SHA="$(git rev-parse HEAD)"
   git tag --points-at "$SHA" -l '*-v*' \
     | sed -E 's/-v[0-9].*$//' | sort -u > "$RWX_VALUES/released-components"
   ```

   (Needs the clone to have fetched tags — check the git/clone package params;
   fetch tags explicitly if the default clone is tag-less.)

2. A `deploy-production` task (gated on that value being non-empty, using the
   locked `greenroom_deploy` vault, `cache: false`) walks the canonical order
   and ships only released workers:

   ```sh
   ORDER="promoter roadie guestlist identity marketing sprout bouncer"
   for w in $ORDER; do
     grep -qx "$w" <<< "$RELEASED" || continue
     (cd workers/$w && bun run db:migrate:production 2>/dev/null || true)  # only D1 workers have it — see note
     (cd workers/$w && bun run deploy:production)
   done
   ```

   Keep D1 migrations BEFORE that worker's code deploy (same invariant as
   `.rwx/deploy.yml` today — don't `|| true` migration FAILURES; the `2>/dev/null
|| true` above is only sketch-shorthand for "script absent"; implement with
   an explicit has-script check). Reuse/adapt `.rwx/deploy.yml` rather than
   duplicating: parameterize it with a `workers` init list, or extract the
   per-worker deploy into a small shared script both files call. Keep the
   post-deploy smoke test + GitHub Deployment recording — subset deploys should
   still smoke-test `https://sproutportal.ca` when bouncer/marketing shipped, or
   the released workers' own health surface otherwise (simplest: always run the
   existing apex smoke test; it exercises the router path end-to-end).

3. **Retire the `v*` tag trigger**: `.rwx/release.yml`'s
   `refs/tags/v*` no longer matches component tags (good — prevents N runs for
   N tags). Replace the file with a **manual re-ship dispatch**: a dispatch
   trigger taking `worker` + `tag` params that deploys one worker at one tag
   (the per-worker rollback/hotfix tool). Keep the production concurrency pool.

4. **Vault access check**: the deploy now runs inside the release-please run
   (branch `main` push context), so the main-locked `greenroom_deploy` vault
   unlocks normally — simpler than today's tag-ref vault story (whose tag-ref
   access-control caveat is documented in `.rwx/release.yml`). Verify once on a
   real release.

### B.4 The semantic change you must accept (or veto)

Path attribution means a commit touching only `packages/*` bumps NO worker and
cuts NO release. Today such a change rides the single repo release to
production. After Part B, it reaches production only when each consuming worker
next cuts its own release ("ride-out"). Mitigations, in recommended order:

1. Accept ride-out as default (shared fixes are usually not urgent alone).
2. Urgent shared fix: land it together with a `fix(<worker>): …`-scoped commit
   per affected worker (any file touch in that worker attributes it), or use
   the §B.3.3 manual dispatch to ship immediately without a release.
3. If two workers must stay in lockstep, add a `linked-versions` plugin group
   for just those. Do NOT reach for `node-workspace` (npm-specific, known
   issues with non-npm workspaces — see sources).

### B.5 Verification

- `npx release-please@17 release-pr --dry-run --token=… --repo-url=… --target-branch=main
--config-file=… --manifest-file=…` on a scratch branch → inspect the printed
  combined Release PR: per-worker sections, correct versions, title matches the
  `is-release-commit` pattern.
- `rwx lint` all touched `.rwx/*.yml`.
- First real release after merge: confirm (a) tags `<worker>-v…` exist only for
  changed workers, (b) exactly one deploy run fired, (c) only released workers
  deployed, in canonical order, (d) `wrangler deployments list` per worker
  corroborates, (e) staging skip (`is-release-commit`) still worked on the
  release commit's CI run.

### B.6 Sources

- release-please manifest docs: https://github.com/googleapis/release-please/blob/main/docs/manifest-releaser.md
- Config schema: https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json
- Customizing (path attribution): https://github.com/googleapis/release-please/blob/main/docs/customizing.md
- Action outputs (context on `paths_released`; NOT available via CLI):
  https://github.com/googleapis/release-please-action — and the v4
  `releases_created` unreliability writeup:
  https://danwakeem.medium.com/beware-the-release-please-v4-github-action-ee71ff9de151
- node-workspace caveats: https://github.com/googleapis/release-please/issues/2432;
  monorepo PR-title issues #2384/#2386.
- Repo: `.rwx/release-please.yml` (postmortem header — keep `on-overflow: queue`),
  `.rwx/release.yml`, `.rwx/deploy.yml`, `release-please-config.json`,
  `.release-please-manifest.json`.
