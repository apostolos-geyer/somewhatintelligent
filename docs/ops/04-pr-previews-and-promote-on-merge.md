# Spec 04 — Per-PR worker previews + build-once-promote-on-merge (RWX + wrangler versions)

> **Status**: ✅ IMPLEMENTED (code complete; live activation gated on ONE
> owner action — creating the `si_preview` vault, see `docs/ops/rwx-setup.md`
> and the vault note in `.rwx/preview.yml`'s header).
> Shipped: `.rwx/preview.yml` (PR trigger active; the `generate-uploads`/upload
> tasks fail at vault resolution until the `si_preview` vault exists;
> CLI-testable), `.rwx/promote-staging.yml`
> (embedded into ci.yml's `deploy-staging` task, replacing the full-fleet
> staging lane; without uploaded versions every affected worker falls back to
> full deploy, so the immediate win is changed-subset deploys and promotion
> self-activates once previews run), `scripts/changed-workers.sh` (self-tested
> ownership rules; rpc-worker changes fan out like ci.yml's gate filter),
> `scripts/promote-staging.sh`
> (PR-head-sha tag resolution — squash-merge safe; wrangler.jsonc-changed and
> version-missing fallbacks), `scripts/generate-preview-tasks.sh` +
> `scripts/pr-preview-comment.sh` (sticky comment, documented 403 degradation).
> **Depends on**: Spec 02 (static configs, top-level = staging, and
> `"preview_urls": true` at top level — REQUIRED, see §3.0). Spec 01 (content
> caching makes the merge-run gate nearly free). Spec 03 assumed for
> `workers/<name>` paths (adjust if dispatched earlier).
> **Decision**: stay on RWX as the single CI/CD brain; use `wrangler versions
upload/deploy` as the primitive; do NOT adopt Cloudflare Workers Builds.
> Rationale in §2.

## 1. Facts the design rests on (researched 2026-07-05, all cited)

- `wrangler versions upload` creates a new version **without deploying it** (0 %
  traffic) and prints a **preview URL**. Two forms: per-version
  `<prefix>-<worker>.<subdomain>.workers.dev`, and a stable alias via
  `--preview-alias <alias>` → `<alias>-<worker>.<subdomain>.workers.dev`
  (wrangler ≥ 4.21; alias+name ≤ 63 chars).
  https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/
- **Bindings, vars, and secrets ride the version.** A preview of a staging
  worker runs against the staging D1/R2/queues its config binds — no extra
  wiring. https://developers.cloudflare.com/workers/configuration/multipart-upload-metadata/
- **What versions CANNOT carry** (each forces a full `wrangler deploy`):
  new **Durable Object migrations**; **route/custom-domain/cron changes**
  (apply via `wrangler triggers deploy` or full deploy); the **first-ever
  upload** of a new Worker.
  https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/
- Promote non-interactively: `wrangler versions deploy <version-id>@100% -y`
  (also `--version-tag <tag>` to resolve a tag set at upload). Only the **last
  100** uploaded versions are promotable. Version ids/tags are queryable via
  `wrangler versions list --json`.
  https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/
- Preview URLs require the workers.dev preview surface: set
  `"preview_urls": true` explicitly (default tracked `workers_dev` only on
  wrangler ≥ 4.44 — pin it, don't rely on defaults).
- A preview of Worker A calls the **currently-deployed** staging Worker B, not
  B's PR version (override only via the `Cloudflare-Workers-Version-Overrides`
  header). https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/
- Workers Builds (Cloudflare's CI/CD): gives free PR comments/check runs +
  branch-alias previews, but **rebuilds from source on every push — it cannot
  promote a previously-built version on merge**, wants to own deploys (vs RWX),
  and means 8 repo connections + watch-path configs. External triggering exists
  (Deploy Hooks) but adds a second brain.
  https://developers.cloudflare.com/workers/ci-cd/builds/ ·
  /build-branches/ · /deploy-hooks/ · /limits-and-pricing/

## 2. Why RWX + DIY versions (not Workers Builds)

Build-once-promote is **only** achievable via the versions path — Workers
Builds rebuilds on merge, so it fails the core requirement outright. Everything
else follows: RWX already runs the gate and knows which workers changed
(content-addressed filters); previews against staging infra come free from the
staging-top-level config (Spec 02); the one thing Workers Builds adds — the
automatic PR comment/check — is ~30 lines of `gh api` in an RWX task. Keep one
CI brain.

## 3. Preconditions

**3.0** In every worker's `wrangler.jsonc` top level (staging): keep
`"workers_dev": true` (staging already has it for bouncer/identity/store —
extend to all 6 or at least all you want previewable) and set
`"preview_urls": true` explicitly. `env.production`: `"workers_dev": false`,
`"preview_urls": false`. **This amends Spec 02's target layout** — implement
there if 02 hasn't landed yet.

**3.1 A preview vault.** The main-locked `si_deploy` vault cannot be
read from PR branches by design. Create `si_preview` (unlocked):

- `CLOUDFLARE_API_TOKEN_PREVIEW`: minted **from this fork's Cloudflare account** (else D1
  7403 — known incident), scoped to **Workers Scripts: Edit + Account
  Settings: Read only** — no D1 edit, no routes, no R2. Uploading a version
  puts 0 % traffic live; acceptable exposure for a private single-maintainer
  repo. Re-evaluate before adding outside collaborators.
- A GitHub token able to comment on PRs: extend the `rwx-automation-si`
  GitHub App with `pull-requests: write` availability in this vault, or first
  test whether RWX's `${{ github.token }}` can post PR comments (unknown —
  verify; if yes, skip the app token here).

## 4. Phase 1 — PR previews for changed workers only

New file `.rwx/preview.yml` (own file; keeps ci.yml's gate lean), triggered on
`github.pull_request`, concurrency pool per branch (cancel-running).

**4.1 Changed-worker detection.** Task `detect` uses the `github/compare`
package (see RWX docs `/event-triggers` → Paths) to diff the PR against its
base, then maps changed paths → workers with the same ownership rules as
ci.yml's filters: a path under `workers/<w>/**` marks `<w>`; a path under
`packages/**`, `bun.lock`, or root config marks **all** workers (honest
fan-out; shared code changes genuinely change every bundle). Emit the list via
`$RWX_VALUES/changed-workers`.

**4.2 Upload fan-out via dynamic tasks.** A generator task writes one task per
changed worker to `$RWX_DYNAMIC_TASKS` (RWX docs `/dynamic-tasks`), each:

- `use`: the shared install/build chain (same bun/install tasks as ci.yml —
  factor them with YAML anchors or accept duplication; embedded-run extraction
  is optional polish);
- `cache: false` (every PR push = new code = new version — intentional);
- for build-step apps (identity): run the worker's build
  first (`vp run build` / astro build, matching its `deploy:staging` script's
  build half);
- upload:

  ```sh
  cd workers/$W
  bunx wrangler versions upload \
    --tag "pr-${{ init.pr-number }}-${{ init.commit-sha }}" \
    --preview-alias "pr-${{ init.pr-number }}" \
    --message "PR #${{ init.pr-number }}" > out.txt
  # parse preview URL + version id from out.txt (or `wrangler versions list --json | jq` for the id)
  echo "$URL"        > "$RWX_VALUES/preview-url-$W"
  echo "$VERSION_ID" > "$RWX_VALUES/version-id-$W"
  echo "$URL" | tee "$RWX_LINKS/preview: $W"      # visible in the RWX UI
  ```

  Env: `CLOUDFLARE_API_TOKEN` from `si_preview` with
  `cache-key: excluded` (RWX docs `/environment-variables`) — irrelevant while
  `cache:false`, but correct hygiene if caching is ever enabled.
  Alias length check: `pr-123` + longest name `si-guestlist-staging` = fine
  (≤ 63).

- **DO-migration guard**: if the PR adds a DO migration, `versions upload`
  fails loudly. Catch that specific failure and emit "preview unavailable
  (DO migration) — will full-deploy on merge" instead of failing the run.

**4.3 Sticky PR comment.** A final task (after all uploads) renders a table —
`worker | preview | version | notes` — and upserts ONE comment (marker
`<!-- si-previews -->`, find-and-edit via `gh api`) so pushes update in
place. Workers not in the changed set are listed as "unchanged (staging)".

**4.4 Scope honesty (include in the PR comment footer).** Preview URLs are bare
workers.dev hosts: no bouncer fronting, no `*.somewhatintelligent.ca` cookies, no
cross-subdomain auth — they validate _units_, not the _journey_. Cross-worker
PRs: each preview calls the _deployed_ staging siblings, not sibling PR
versions. The journey check remains post-merge staging.

## 5. Phase 2 — promote-on-merge for staging

Rewire ci.yml's `deploy-staging` lane (keep the gate exactly as is):

1. `detect` (same mapping as §4.1, diffing the pushed commit against the
   previous deployed state — simplest correct proxy: the commit's own diff via
   `github/compare` against the parent; a `packages/**` change ⇒ all workers).
2. For each changed worker, in the canonical order (promoter, roadie →
   guestlist → identity, store → bouncer LAST — the 10143
   invariant):
   - **migrations first**: if `workers/<w>/migrations/**` changed, run its
     `db:migrate:staging` (D1 token needed ⇒ this task uses the LOCKED deploy
     vault; it runs on main only — fine).
   - **resolve the PR version**: map merge commit → PR number (`gh api
repos/:owner/:repo/commits/$SHA/pulls`), then
     `wrangler versions list --json` → newest version tagged
     `pr-<n>-<pr-head-sha>`; verify the tag's sha matches the PR head that got
     merged.
   - **promote or fallback**:
     - version found AND no DO-migration AND no route/cron/config-trigger
       change in the diff → `wrangler versions deploy <id>@100% -y`;
       if routes/cron changed too → follow with `wrangler triggers deploy`.
     - else (no version — direct push to main, >100 versions elapsed, DO
       migration, first deploy of a new worker) → full
       `bun run deploy:staging` (build + `wrangler deploy`).
   - unchanged workers: **skip entirely** — only workers `detect` marks
     changed run a promote or fallback deploy.
3. Keep the GitHub Deployment record + apex smoke test from `.rwx/deploy.yml`.
4. Squash-merge nuance: the PR head sha (what previews were built from) is not
   the merge sha. Resolving via PR number + upload tag (2 above) handles this;
   never try to match the merge sha against version tags.

**Production is out of scope for promotion**: versions are per-worker, and
production is a _different_ worker (`…-production`), so staging versions cannot
be promoted to it. Production stays Spec 03's released-subset full deploy —
correct and rare. (If prod promote is ever wanted: upload a version to the
production worker during the release run, then promote — a later, separate
decision.)

## 6. D1 schema changes vs previews

Default: **shared staging D1 + backward-compatible migrations + Time Travel**
(30-day point-in-time restore on paid: `wrangler d1 time-travel restore …`,
https://developers.cloudflare.com/d1/reference/time-travel/).

Rules of the road (document in the PR-comment footer + CLAUDE.md):

- Migrations must be additive/backward-compatible: deployed staging code and
  PR preview code share one schema.
- Migrations apply **on merge**, not at PR time. So a preview whose new code
  reads a not-yet-applied column will error on those paths — expected; the
  comment should flag "schema-PR: preview degraded" when `migrations/**` is in
  the diff.
- Escape hatch for genuinely breaking schema work: **ephemeral per-PR
  deploy** — `wrangler d1 create pr-<n>-<db>`, apply migrations to it, full
  `wrangler deploy` to a disposable worker name with the D1 id swapped in by a
  small script, delete both on PR close. D1 limits allow 50 k DBs; account cap
  is 500 workers — cleanup matters. This is deliberately manual/opt-in (a
  dispatch trigger, not automatic) — do not build it until a real PR needs it;
  the spec just reserves the design.

## 7. Verification

1. Scratch PR touching one worker (e.g. promoter): run `.rwx/preview.yml`
   via `rwx run` — assert exactly one upload task, PR comment appears with a
   working preview URL that answers, alias URL stable across a second push.
2. PR touching `packages/ui`: all workers upload; comment lists all.
3. Merge the scratch PR: staging lane promotes (check `wrangler deployments
list` shows the promoted version id, and NO build ran for the worker), other
   workers untouched; smoke test green.
4. PR adding a Durable Object migration to a worker: preview task reports the
   guard message; merge falls back to full deploy.
5. Rollback drill: `wrangler versions deploy <previous-id>@100% -y` restores
   the prior staging version in seconds (document as the staging rollback).

## 8. Sources

Cloudflare: preview-urls · deployment-management · gradual-deployments (+
/with-durable-objects/) · version-overrides · multipart-upload-metadata ·
ci-cd/builds (+ build-branches, deploy-hooks, limits-and-pricing) · d1
time-travel · d1 limits — all under developers.cloudflare.com (URLs inline
above). RWX: `/dynamic-tasks`, `/output-values`, `/links`,
`/environment-variables` (cache-key exclusion), `/vaults` (locked-vault branch
semantics). Repo: `.rwx/ci.yml`, `.rwx/deploy.yml`, per-worker `deploy:*`
scripts, Spec 02/03 in this directory.
