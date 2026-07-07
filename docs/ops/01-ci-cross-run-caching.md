# Spec 01 — Make RWX CI cache across runs (filters + determinism)

> **Status**: ✅ IMPLEMENTED 2026-07-05 (same session). Verified: unchanged-tree
> run `53148a95` = all 21 gate tasks + install/bootstrap/types HIT; sprout-only
> touch run `cee7242b` re-ran exactly typecheck-sprout + test-sprout.
> Deviations from the spec as written:
>
> - F3 implemented as output-layer scrub only (no input filter on bootstrap —
>   it re-executes each commit at ~15 s with deterministic outputs; Spec 05's
>   env:init split makes the input filter trivial, do it there).
> - Two additional non-determinism sources found and scrubbed beyond the spec:
>   vp's task-cache sqlite (`node_modules/.vite/**`, written by `run.cache:true`)
>   and wrangler's timestamped logs (`~/.config/.wrangler/**`, system path) —
>   from bootstrap AND types output layers.
> - `types` filter needed the worker entry files (`apps/*/src/worker.ts`,
>   `services/*/src/index.ts`): `wrangler types` validates `main` exists
>   (empirically confirmed, run 1 failed without them).
> - Gate negations implemented as a second alias (`*gate-neg`) appended after
>   each task's `<pkg>/**` entry — filter negation is last-match-wins, so
>   in-alias-prefix placement would have been re-included by the pkg glob.
> - No tool-cache added (install HITs on manifest-stable commits; misses are
>   rare enough that incremental replay isn't worth the vault wiring yet).
>   **Depends on**: nothing (applies to the current tree). Later specs (02, 03) adjust
>   paths/tasks this spec touches — see "Interaction with other specs" at the bottom.
>   **Verify with**: the `rwx run … && rwx results --json` loop in §7 — no deploy
>   access needed; the whole spec is exercisable from a feature branch.

## 1. Context

PR #43 changed 4 files, all under `apps/sprout/` (`src/router.tsx`,
`src/routes/_portal.tsx`, `src/routes/admin.tsx`, `src/styles.css`). Its CI run
re-executed **everything**: install, bootstrap, types, all 14 typecheck tasks, all
7 test tasks. RWX's content-based cache is cross-run by design — same inputs =
cache hit "regardless of when or where the original task ran" (`rwx docs pull
/caching`) — so nothing extra needs to be "enabled" for cross-run caching. Our
task definitions defeat it.

Evidence — run `b7caa100c9d248398b2964bdea16e128` (branch
`claude/slow-navigation-routing-8fslrg`, commit `540fa0f`, 140 s wall):

| task                              | result                    | seconds    |
| --------------------------------- | ------------------------- | ---------- |
| code                              | MISS (inherent — new sha) | 16         |
| captain                           | MISS                      | 9          |
| system-packages, bun, ~base-image | **HIT**                   | —          |
| install                           | MISS                      | 43         |
| bootstrap                         | MISS                      | 22         |
| types                             | MISS                      | 7          |
| typecheck-\* (14 tasks)           | **all MISS**              | 1–33 each  |
| test-\* (7 tasks)                 | **all MISS**              | 24–46 each |

Reproduce this table for any run:

```sh
rwx results --branch <branch> --json | jq -r '.Tasks[] |
  [.Key, (if .CacheHitFromTaskID then "HIT" else "MISS" end),
   (.CompletedRuntimeSeconds|tostring)] | @tsv' | column -t
```

## 2. How RWX caching actually works (read these before editing)

Pull these with `rwx docs pull <path>`; the spec below cites them:

- `/caching` — cache key = task definition + **filesystem produced by `use`
  dependencies** + env vars + base + runner. Content-based: a task can HIT even
  when its upstream re-executed, **iff the upstream reproduced byte-identical
  output**.
- `/filtering-files` — `filter:` restricts which **workspace** files are on disk
  and in the cache key. Supports negation (`"!pattern"`, last match wins).
  **Filters do not apply outside the workspace**: "If any files change outside of
  the workspace … it'll always result in a different cache key."
- `/filesystem` — `outputs.filesystem.filter` restricts which files a task
  _contributes_ to downstream layers; `workspace:` list is relative,
  `system:` list is absolute paths.
- `/tool-caches` — incremental replay for install-type tasks on a cache MISS
  (does not affect HIT determination).

## 3. Root causes (all three are required to explain the table)

### RC1 — `install` has no `filter`, so it re-executes on every commit

`.rwx/ci.yml` task `install` (`bun install --frozen-lockfile --ignore-scripts`)
`use: [code, bun]` with **no filter** → its cache key includes the entire clone,
including `.git/` (which differs for every commit even when no tracked file
changed). 43 s of pure re-execution per run. This is the textbook case in
`/guides/ci` ("Without a filter, any source file change would bust the cache for
`npm-install`").

### RC2 — a re-executed `install` poisons every downstream task via _system_

### paths that filters can't exclude

When install re-executes, bun writes both `node_modules/` (workspace) and its
global cache under `$HOME/.bun/install/cache/` (**system** path — bun's global
install cache). Downstream tasks' cache keys include all system-path files from
their `use` chain, and per `/filtering-files` a `filter:` **only applies to the
workspace**. So even a gate task whose workspace filter matches perfectly gets a
new cache key whenever install's system-path output differs (registry cache
manifests, tmp files — not byte-reproducible). This is why _filtered_ gate tasks
still missed.

### RC3 — `bootstrap` writes non-deterministic sqlite **inside** the gate filter

CI's `bootstrap` runs `bun run bootstrap` = `render-wrangler` + `vp run -r
bootstrap`, and each D1-bearing package's `scripts/bootstrap.ts` calls
`applyD1MigrationsLocal(...)` (see `scripts/apply-migrations.ts` and e.g.
`services/guestlist/scripts/bootstrap.ts:33`). That materializes sqlite state
under `services/<svc>/.wrangler/state/v3/d1/**` (and `apps/sprout/.wrangler/…`).
SQLite bytes are not reproducible across runs, and the shared `gate-filter`
includes `services/guestlist/**`, `services/promoter/**`, `services/roadie/**` —
so **every** gate task inherits changed bytes whenever bootstrap re-executes
(which is every run, per RC1/no-filter).

**The state is not even used by tests.** Every test-bearing D1 worker
self-applies migrations in-pool via `cloudflare:test`:

- `services/guestlist/__tests__/apply-migrations.ts` — `applyD1Migrations(env.DB,
env.TEST_MIGRATIONS)`; `TEST_MIGRATIONS` is injected by
  `services/guestlist/vite.config.ts` via `readD1Migrations()`.
- Same pattern: `services/roadie/__tests__/apply-migrations.ts`,
  `apps/sprout/__tests__/integration/apply-migrations.ts`.

Local `.wrangler/state` exists for `wrangler dev` / the dev stack only. In CI it
is pure cache poison.

Secondary notes (not load-bearing, don't chase):

- `types` output (`worker-configuration.d.ts`) **is** deterministic — header
  carries a config hash, not a timestamp (verified against generated files).
- `captain` (rwx/install-captain) misses each run (~9 s). Package-internal;
  accept it.
- The `bootstrap` seeding probe (`fetch(LOCAL_IDENTITY_URL…)`) fails fast in CI
  and exits 0 — the `[defer]` path. Fine.
- `.dev.vars` files seeded by `writeDevVarsIfMissing` are deterministic bytes
  (fixed constants from `scripts/dev-config.ts`) — safe to keep in layers.

## 4. Fix design

### F1 — filter `install` down to its real inputs

```yaml
- key: install
  use: [code, bun]
  run: bun install --frozen-lockfile --ignore-scripts
  filter:
    - package.json
    - bun.lock
    - bunfig.toml
    - apps/*/package.json
    - packages/*/package.json
    - services/*/package.json
  timeout: 8m
```

(Confirm the workspace globs cover every `package.json` that participates in the
workspace — root `package.json` `workspaces` field is `apps/*`, `packages/*`,
`services/*`. If `e2e/` or root-adjacent packages carry a `package.json` that
affects install, add them.)

Effect: install HITs on any commit that doesn't touch dependency manifests →
its cached output layer is byte-identical → RC2 disappears for the common case.

### F2 — stop bun's system-path cache from entering the layer at all

Belt-and-suspenders for the case where install legitimately re-runs (lockfile
changed): exclude the global bun cache from install's output layer so downstream
keys depend only on `node_modules/**`:

```yaml
outputs:
  filesystem:
    filter:
      workspace: ["node_modules/**"]
      system: ["!<HOME>/.bun/install/cache/**"]
```

Implementation note: resolve `<HOME>` empirically — add a throwaway `run: echo
$HOME; ls -la $HOME/.bun` to a debug task on the RWX image (ubuntu:24.04 +
rwx/base), then hard-code the absolute path (system filters must be absolute;
`~` is not expanded). If the `system:` negation proves fiddly, the alternative
is `bun install --frozen-lockfile --ignore-scripts --no-cache` (slower misses,
zero system noise) — measure both, prefer the filter if it works. Also verify
whether `use: bun`'s installer layer puts anything else non-deterministic in
`$HOME` (`.bun/install/global` etc.) while you're in there.

Optionally add a tool cache so the (now rare) misses replay incrementally:

```yaml
tool-cache:
  vault: greenroom_main # must be a vault unlocked only by main — see /tool-caches
tasks:
  - key: install
    tool-cache: ci-bun-install
```

Only do this if a suitable vault already exists or is one click away; it's a
speed optimization for misses, not part of the correctness fix.

### F3 — CI bootstrap must not apply local D1 migrations (and must be filtered)

Replace the `bootstrap` task with a task that does only what the gate consumes:
render `wrangler.jsonc` + seed `.dev.vars`. Do **not** run
`scripts/apply-migrations.ts`, and do not let per-package `bootstrap.ts`
migration calls run in CI.

Two acceptable implementations — pick the first unless it fights you:

1. **Surgical (preferred now):** keep `run: bun run bootstrap` but add
   `outputs: { filesystem: { filter: ["!**/.wrangler/**"] } }` so the sqlite
   never reaches downstream layers, **and** add an input `filter` so bootstrap
   itself caches:

   ```yaml
   - key: bootstrap
     use: install
     run: bun run bootstrap
     filter:
       - node_modules/**
       - scripts/**
       - packages/config/**
       - "**/wrangler.template.jsonc"
       - "**/scripts/bootstrap.ts"
       - "**/migrations/**"
       - "*.json"
       - bun.lock
     outputs:
       filesystem:
         filter: ["!**/.wrangler/**"]
   ```

   (`node_modules/**` must stay in the filter — the scripts import
   `@si/config` from it. That's correct: bootstrap should re-run when
   deps change, and node_modules is now stable per F1/F2.)

2. **Cleaner (fine to do instead if Spec 05 hasn't landed but you have 30 extra
   minutes):** split per-package `bootstrap` scripts into `bootstrap:vars`
   (.dev.vars only) and `bootstrap:db` (migrations + seed), point CI at
   `render + vars` only. This is Spec 05's script split — if you do it here, do
   it exactly as Spec 05 §"script split" describes so the two specs converge.

Also add the negation `"!**/.wrangler/**"` to the shared `gate-filter` alias in
`.rwx/ci.yml` regardless, so no future task reintroduces sqlite into a cache key.

### F4 — filter `types`

```yaml
- key: types
  use: bootstrap
  run: bun run types
  filter:
    - node_modules/**
    - "**/wrangler.jsonc"
    - "**/wrangler.template.jsonc"
    - "*.json"
    - "**/package.json"
  timeout: 8m
```

Its output is deterministic (hash-headered `worker-configuration.d.ts`), so once
its inputs are stable it HITs, and even when it re-runs it doesn't poison
downstream.

### F5 — leave the gate tasks' structure alone

The per-package typecheck/test split and the `gate-filter` alias are already
right. Only two edits: the `"!**/.wrangler/**"` negation (F3) and — after
verifying F1–F4 — re-check whether `node_modules/**` byte-stability holds across
two clean runs (§7 verifies this empirically).

## 5. What NOT to do

- Do not add `cache: false` anywhere in the gate (deploy tasks already use it
  correctly — deploys must always execute).
- Do not switch to path-based triggering (`github/compare`) — content-based
  caching supersedes it and handles shared-package fan-out correctly.
- Do not try to make `code` (clone) cache — a new sha is a new clone; 16 s is
  the floor.
- Do not "fix" `captain`'s 9 s miss — package-internal, not ours.

## 6. Expected end state

For a PR touching only `apps/sprout/src/**`:

| task                                                       | expected               |
| ---------------------------------------------------------- | ---------------------- |
| code                                                       | MISS (~16 s, inherent) |
| captain                                                    | MISS (~9 s, accepted)  |
| system-packages / bun / node / install / bootstrap / types | **HIT**                |
| typecheck-sprout, test-sprout                              | MISS (real work)       |
| all other typecheck-_/test-_                               | **HIT**                |
| gate                                                       | HIT/instant            |

Wall target ≤ ~75 s (from 140 s); compute drops ~80 %. A `packages/*` or
`bun.lock` change still correctly re-runs everything.

## 7. Verification (do all three)

1. **Lint**: `rwx lint .rwx/ci.yml`.
2. **Determinism probe**: from a branch with NO local edits, `rwx run
.rwx/ci.yml --wait` twice in a row. Second run must be all-HIT except `code`
   - `captain`. If any gate task misses on run 2, diff its inputs: something in
     the layer chain is still non-deterministic — use `rwx results --json` +
     the jq snippet in §1, then inspect that task's `filter` and its parents'
     outputs.
3. **Scoped-change probe**: `touch`-edit a comment in `apps/sprout/src/router.tsx`,
   `rwx run .rwx/ci.yml --wait`; assert only `typecheck-sprout` + `test-sprout`
   (+ code/captain) miss, using the jq table. Then edit a comment in
   `packages/ui/src/**` and assert the fan-out is everything that filters on
   `packages/**` (i.e. all gate tasks) — that's correct behavior, not a bug.

`rwx run` patches your local working tree onto the last pushed commit
(`/cli-triggers`), so all of this works without committing.

## 8. Interaction with other specs

- **Spec 02** deletes `render-wrangler` + templates: the `bootstrap` task loses
  its render step and the `types` filter drops `wrangler.template.jsonc` in
  favor of checked-in `wrangler.jsonc`. Pure simplification of this spec's
  result; no conflict.
- **Spec 03** moves `apps/*` + `services/*` → `workers/*`: mechanical path
  rewrite of every filter glob in `.rwx/ci.yml` (part of Spec 03's sweep).
- **Spec 05** formalizes the bootstrap script split (F3 option 2).

## 9. References

- RWX docs: `/caching`, `/filtering-files`, `/filesystem`, `/tool-caches`,
  `/guides/ci`, `/cli-triggers` (all via `rwx docs pull`).
- Evidence run: RWX run id `b7caa100c9d248398b2964bdea16e128` (PR #43).
- Files: `.rwx/ci.yml`, `scripts/apply-migrations.ts`, `scripts/dev-config.ts`,
  `services/guestlist/scripts/bootstrap.ts`,
  `services/{guestlist,roadie}/__tests__/apply-migrations.ts`,
  `apps/sprout/__tests__/integration/apply-migrations.ts`,
  `services/guestlist/vite.config.ts` (TEST_MIGRATIONS injection).
