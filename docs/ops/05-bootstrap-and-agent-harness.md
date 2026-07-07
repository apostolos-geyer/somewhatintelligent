# Spec 05 — Slim bootstrap; make the repo an agent-grade harness

> **Status**: ✅ IMPLEMENTED 2026-07-06 (commit `5a427fc`; RWX gate green
> `2e498dc9`; fresh-worktree clone contract verified end-to-end). Deviations:
> `db:migrate:local` + `seed` became vp TASKS with `cache: false` and left
> package.json scripts entirely — vp forbids task/script name collisions, and
> a cache-replayed migration/seed would silently skip real work; `env:init`
> stays a cached script because vp verifiably restores its tracked `.dev.vars`
> output on replay (probe: deleting one invalidated exactly its task).
> §3.2's per-worker input/output declarations proved unnecessary — root
> `run.cache: true` auto-tracking passed the deletion probe.
> **Depends on**: Spec 02 (no render step anywhere). Spec 01 F3-option-2 is a
> subset of this spec — if 01 landed with option 1 (surgical), this spec
> supersedes that task body.
> **Design frame**: OpenAI's "harness engineering" write-up
> (https://openai.com/index/harness-engineering/) — the repo is the harness;
> agents are the workforce. Concretely borrowed here: repo as system of record;
> fresh clone → working environment with zero tribal steps; boot-per-worktree;
> fast, legible feedback loops; docs as a map ("AGENTS.md ~100 lines pointing
> deeper"), not a manual.

## 1. Problem

`bun run bootstrap` today = render wrangler (dies with Spec 02) + for EVERY
worker: seed `.dev.vars` + apply local D1 migrations + attempt live-stack demo
seeding. Consequences:

- CI pays for migrations/seeding it never uses (tests self-apply migrations via
  `cloudflare:test` — see Spec 01 §3/RC3) and the sqlite output poisons caches.
- A fresh clone can't typecheck or test until bootstrap has run
  (worker-configuration.d.ts, wrangler.jsonc — the latter fixed by Spec 02).
- Working on ONE worker still means booting/bootstrapping the fleet, because
  service bindings resolve against locally-running siblings.
- The env-var story is scattered: `scripts/dev-config.ts` constants, six
  seeded `.dev.vars`, CI vault secrets, `wrangler secret` pushes — with no
  single contract saying who needs what.

## 2. Current state (verified)

Per-worker `scripts/bootstrap.ts` decomposes into exactly three concerns:

| worker                                                   | .dev.vars seed         | local D1 migrate | demo seed                                                                            |
| -------------------------------------------------------- | ---------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| identity (`apps/identity/scripts/bootstrap.ts`, 8 lines) | ✅ (PLATFORM_DEV_VARS) | —                | —                                                                                    |
| promoter (12) / bouncer (25)                             | ✅                     | —                | —                                                                                    |
| roadie (15)                                              | ✅                     | ✅               | —                                                                                    |
| sprout (36)                                              | ✅ (+BNC_ATT dev key)  | ✅               | ✅ `seed.ts` (local D1; `--target staging` for remote)                               |
| guestlist (159)                                          | ✅ (+auth secrets)     | ✅               | ✅ users/orgs — needs LIVE stack; probes identity and `[defer]`s cleanly when absent |

Shared constants + helpers: `scripts/dev-config.ts` (LOCAL\_\* constants,
`writeDevVarsIfMissing`, `applyD1MigrationsLocal`, d1Exec/d1Query).
Root orchestration: `package.json` scripts chain bash (`render && vp run -r
bootstrap` etc.). `db:migrate:local` already exists per D1 worker.

vp task facts (viteplus.dev/guide/run + /guide/cache): tasks declared in
`vite.config.ts` under `run.tasks` are **cached** (auto-tracked inputs, plus
explicit `input`/`output`/`env`); bare `package.json` scripts are not cached
by default, **but this repo's root `vite.config.ts` sets `run: { cache: true }`**
(and a live `cache.db` confirms it) — so script-level caching is already on;
what §3.2 adds is _precise_ inputs via explicit task definitions so cache
correctness doesn't ride on auto-tracking a `wrangler` subprocess.
`dependsOn` supports same-package, `pkg#task`, and `{ task, from:
"dependencies" }` forms. Cache lives in `node_modules/.vite/task-cache` (NOT
`~/.vite-plus` — see repo memory: CI cache was "dead" until this path was
persisted). `vp run -r dev` does not fire the portless-wrapped dev scripts
(documented in CLAUDE.md) — the dev entrypoint is portless, not vp.

## 3. Target design

### 3.1 Split the per-worker scripts (mechanical)

Per worker, replace the single `bootstrap` with three idempotent scripts —
same names everywhere:

- `env:init` — `.dev.vars` seeding only (today's `writeDevVarsIfMissing` block).
  Deterministic, offline, < 1 s.
- `db:migrate:local` — already exists (guestlist/roadie/sprout only).
- `seed` — demo data (sprout `seed.ts`; guestlist users/orgs incl. the
  live-stack probe). Only these two workers have it.

Root scripts become:

```jsonc
"bootstrap": "vp run -r env:init",                  // cheap, always safe
"migrate":   "vp run -r db:migrate:local",
"seed":      "vp run -r seed",                      // needs dev stack up (guestlist part)
"dev":       "bun scripts/predev.ts && portless …"  // see 3.2
```

Delete the per-worker `bootstrap` script key (grep for consumers first:
`.rwx/ci.yml`, docs, README) **and delete root `scripts/apply-migrations.ts`**
— it duplicates the per-package `db:migrate:local` path (same
`applyD1MigrationsLocal` on the same three workers) and its hardcoded
`D1_PACKAGES` list is one more thing to forget when a worker gains a D1.
`vp run -r db:migrate:local` replaces it exactly (only D1 workers define the
script, so `-r` naturally selects them).

### 3.2 Lazy, cached pre-dev via vp tasks

Move the boot chain into cached vp tasks so it reruns only when inputs change.
In each D1 worker's `vite.config.ts`:

```ts
run: {
  tasks: {
    "env:init": { command: "bun scripts/env-init.ts",
                  input: ["scripts/env-init.ts", "../../scripts/dev-config.ts"],
                  output: [] },            // .dev.vars is gitignored; verify vp
                                           // allows untracked outputs — else leave
                                           // output undeclared and rely on the
                                           // script's own existsSync idempotence
    "db:prepare": { command: "bun run db:migrate:local",
                    dependsOn: ["env:init"],
                    input: ["migrations/**", "wrangler.jsonc"] },
  },
}
```

and the root `dev` entry runs `vp run -r db:prepare` before starting portless.
Result: first `bun run dev` after clone migrates everything; subsequent runs
are cache hits; a new migration file re-runs exactly that worker's task.
(Exact vp config syntax: verify against viteplus.dev/guide/run at
implementation time — the `input`/`output`/`dependsOn` shapes above are from
the docs as of 2026-07; don't trust field names blindly.)

### 3.3 The fresh-clone contract (the harness's front door)

After this spec, these are the ONLY commands an agent (or human) needs, in
order, from a fresh clone — enforce and document exactly this in README +
CLAUDE.md:

```sh
bun install            # → typecheck + unit/pool tests work immediately
bun run types          # → worker-configuration.d.ts (needed once, and after
                       #   wrangler.jsonc changes)
bun run dev            # → full local stack; lazily seeds .dev.vars + migrates
bun run seed           # → demo users/brands (needs dev stack up)
bun run test / test:pool / test:e2e
```

Nothing may require: render steps, manual .dev.vars authoring, remembering
which worker needs migrations, or a live Cloudflare login — **except** the
documented remote-dependent features (AI/Vectorize/Browser remote proxy,
solo-mode below), which degrade cleanly when absent.

CI (`.rwx/ci.yml`) consumes the same scripts: its bootstrap task becomes
`bun run bootstrap` (= `env:init` only — no migrations, no sqlite; this is
Spec 01 F3-option-2 landing for real).

### 3.4 Solo-mode: one worker locally, staging fleet remotely

Rationale (owner-stated): you almost never edit two workers at once. Booting
six workers to touch one is harness friction. Cloudflare's **remote bindings**
let a locally-running worker's service bindings/D1/queues target deployed
workers: `"remote": true` on a binding in wrangler config is honored by
`wrangler dev` / the Vite plugin (verify the current key name and coverage per
binding type against developers.cloudflare.com — this went GA during 2025;
older `experimental_remote` spellings may appear in docs).

Design: do NOT put `remote: true` in the checked-in configs (it would change
every developer's default and is dev-only semantics mixed into deploy config).
Instead add per-worker `dev:solo` script that runs wrangler dev/vite with a
dev-only config overlay:

- a sibling `wrangler.solo.jsonc` extending `wrangler.jsonc` via wrangler's
  config-extending mechanism if available, or generated on the fly by a tiny
  script that reads `wrangler.jsonc`, stamps `"remote": true` onto
  service/D1/queue bindings, writes `.wrangler/solo-config.jsonc` (gitignored),
  and execs `wrangler dev -c` it. Keep it ≤ 50 lines, no templating creep —
  this is a dev overlay, not the Spec-02 renderer reborn.
- requires `CLOUDFLARE_API_TOKEN` (or `wrangler login`) in the environment —
  exactly what cloud/agent containers already carry per the deploy runbooks.
  Since top-level config IS staging (Spec 02), remote bindings resolve to the
  staging fleet with zero extra mapping.

Scope guard: solo-mode is additive DX. The all-local stack (portless + dev
registry) remains the canonical path for cross-worker work and schema changes,
and stays what `bun run dev` does.

### 3.5 One env-var contract table

Write `docs/ops/env-vars.md` (and link from CLAUDE.md): one table, every
variable: name · consumed by · dev source (.dev.vars seeder / dev-config
constant) · CI source (RWX vault) · staging/prod source (wrangler `vars` vs
`wrangler secret` vs binding). Seed it from: `scripts/dev-config.ts`, the six
seeders, `.rwx/deploy.yml` `deploy-env` alias, `packages/secrets`,
`docs/secrets.md`, `docs/runbooks/SECRETS.md`. Rule going forward (add to
CLAUDE.md): a new env var is not done until it has a row.

## 4. What NOT to do

- No `.env`-at-root loader shared across workers — wrangler's `.dev.vars`
  per-worker model is the platform convention; the _seeders_ are the sharing
  mechanism.
- No new bash chains in root package.json — orchestration moves toward vp
  tasks, not away.
- Don't cache `seed` (it talks to live local state) — `cache: false`.
- Don't make solo-mode the default dev path (schema changes + cross-worker
  flows need the local fleet).

## 5. Verification

1. Fresh clone in a container (or `git clean -xfd` a worktree + reinstall):
   run the §3.3 sequence top to bottom; each command succeeds with no manual
   intervention. Time `bun install` → first green `bun run test`.
2. `bun run dev` twice: second run's db:prepare tasks are vp cache hits
   (`vp run -r db:prepare --last-details` or `-v` shows HIT/MISS per task).
   Add a no-op migration file to sprout → only sprout's task re-runs.
3. Walk the portal journey per `docs/sprout/10-local-stack-and-testing-runbook.md`
   after `bun run seed` (alice/acme demo intact — do not regress the demo
   fixtures; see repo memory).
4. Solo-mode: with only guestlist running via `dev:solo` + a valid
   CLOUDFLARE*API_TOKEN, a request that crosses its PROMOTER/ROADIE bindings
   reaches the \_staging* workers (verify via staging logs / responses).
5. CI: `.rwx/ci.yml` run shows bootstrap task < 5 s, no `.wrangler` state in
   any layer (Spec 01's §7 probes stay green).

## 6. References

- Harness engineering: https://openai.com/index/harness-engineering/ (mirror
  summaries if 403: xiaow.dev claude_notes 2026-03-25 entry).
- vp tasks/caching: https://viteplus.dev/guide/run, https://viteplus.dev/guide/cache.
- Files: `scripts/dev-config.ts`, `scripts/apply-migrations.ts`,
  `{apps,services}/*/scripts/bootstrap.ts`, root `package.json`, `.rwx/ci.yml`,
  `portless.json`, `docs/sprout/10-local-stack-and-testing-runbook.md`.
- Repo memory anchors: vp task-cache real path (`node_modules/.vite/task-cache`);
  dev-direct stamper per app; preserve alice/bob/carol demo fixtures.
- Remote bindings: developers.cloudflare.com/workers/development-testing/
  (verify exact config key + per-binding coverage at implementation time).
