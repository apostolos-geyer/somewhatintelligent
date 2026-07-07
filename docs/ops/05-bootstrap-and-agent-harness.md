# Bootstrap and agent harness

**Design frame**: OpenAI's "harness engineering" write-up
(https://openai.com/index/harness-engineering/) — the repo is the harness;
agents are the workforce. Concretely: the repo is the system of record; a
fresh clone reaches a working environment with zero tribal steps; boot is
per-worktree; feedback loops (typecheck/test/build) are fast and legible;
docs are a map ("CLAUDE.md ~100 lines pointing deeper"), not a manual.

## 1. Per-worker bootstrap scripts

Each worker's `scripts/env-init.ts` seeds that worker's `.dev.vars` file
(deterministic, offline, sub-second). Two workers additionally seed demo
data. D1 workers apply local migrations via a `db:migrate:local` vp task:

| worker    | env:init | db:migrate:local | seed                                                                                                                   |
| --------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| bouncer   | ✅       | —                | —                                                                                                                      |
| promoter  | ✅       | —                | —                                                                                                                      |
| identity  | ✅       | —                | —                                                                                                                      |
| roadie    | ✅       | ✅               | —                                                                                                                      |
| guestlist | ✅       | ✅               | ✅ `scripts/seed.ts` — users/orgs; probes identity's `/api/auth/ok` and `[defer]`s cleanly when the dev stack isn't up |
| store     | ✅       | ✅               | ✅ `scripts/seed.ts`                                                                                                   |

Shared constants + helpers live in `scripts/dev-config.ts` (`LOCAL_*`
constants, `writeDevVarsIfMissing`, `applyD1MigrationsLocal`, `d1Exec`/
`d1Query`, and the portless-CA `DEV_SPAWN_ENV` used by subprocess spawns).

Root scripts:

```jsonc
"bootstrap": "vp run -r env:init",        // cheap, always safe
"migrate":   "vp run -r db:migrate:local",
"seed":      "vp run -r seed",            // needs the dev stack up (guestlist's identity probe)
"dev":       "bun scripts/dev-stack.ts",  // see §3
```

## 2. Task caching

`db:migrate:local` and `seed` are declared as vp tasks in each D1 worker's
`vite.config.ts` under `run.tasks`, both with `cache: false` — they mutate
live local state (D1 schema, demo rows), and a cache-replayed "success" would
silently skip real work:

```ts
run: {
  tasks: {
    "db:migrate:local": {
      command: "wrangler d1 migrations apply DB --local",
      cache: false,
    },
    seed: {
      command: "bun scripts/seed.ts",
      cache: false,
    },
  },
}
```

`env:init` runs as a plain `package.json` script, not a vp task — it's cached
anyway because the root `vite.config.ts` sets `run: { cache: true }`, which
auto-tracks script inputs. The task-cache lives at
`node_modules/.vite/task-cache`. `.rwx/ci.yml`'s `bootstrap` step runs
`bun run bootstrap` (`env:init` only, no migrations, no D1 state); tests
self-apply their own migrations via `TEST_MIGRATIONS` instead.

## 3. The fresh-clone contract

From a fresh clone, in order:

```sh
bun install             # → typecheck + per-worker tests work immediately
bun run types           # → worker-configuration.d.ts (also after wrangler.jsonc changes)
bun run dev              # → bun scripts/dev-stack.ts: cached env:init + local D1
                         #   migrations, then guestlist+identity+roadie+store,
                         #   each exactly its own per-directory `bun run dev`,
                         #   with portless ensured and prefixed logs
bun run seed             # → demo users/orgs (needs the dev stack up)
bun run test             # → packages/* unit tier (root)
cd workers/<name> && bun run test   # → that worker's own suite
bun run test:e2e         # → Playwright specs in e2e/
```

`bun run dev` also accepts an explicit subset: `bun run dev guestlist
identity`. Any child process exiting tears the whole stack down. Nothing in
this sequence requires a live Cloudflare login — except solo-mode (§4 below)
and any remote-dependent feature, which degrades cleanly when absent.

## 4. Solo-mode: one worker locally, staging fleet remotely

Booting the whole fleet to touch one worker is friction most edits don't
need. Cloudflare's **remote bindings** let a locally-running worker's
service/D1/queue/R2 bindings target deployed workers: `"remote": true` on a
binding is honored by `wrangler dev` and the Vite plugin.

The checked-in `wrangler.jsonc` files never set `remote: true` — that would
change every developer's default and mixes dev-only semantics into deploy
config. Instead, each worker has a `dev:solo` script
(`bun ../../scripts/dev-solo.ts`) that reads the worker's `wrangler.jsonc`,
stamps `"remote": true` onto its top-level service/D1/queue/R2 bindings,
writes the result to a gitignored `wrangler.solo.jsonc` beside it, and execs
`wrangler dev -c` against that file. Because each `wrangler.jsonc`'s
top-level config is the staging section, remote bindings resolve to the
staging fleet with zero extra mapping.

`dev:solo` requires `CLOUDFLARE_API_TOKEN` (or `wrangler login`) — remote
bindings proxy through the Cloudflare account. The all-local fleet
(`bun run dev`) remains the canonical path for cross-worker work and schema
changes; solo-mode is additive DX, not the default.

## 5. The env-var contract

[`docs/ops/env-vars.md`](env-vars.md) is the single contract for every
environment variable and secret the platform consumes: name, consumer, dev
source, CI source, staging/production source. It's seeded from
`scripts/dev-config.ts`, the per-worker `env-init.ts` seeders, every
`workers/*/wrangler.jsonc`, `packages/secrets/src/manifest.ts`,
`.rwx/deploy.yml` + `.rwx/release-please.yml`, `docs/secrets.md`, and
`docs/runbooks/SECRETS.md`. A new env var is not done until it has a row
there.

## 6. Guardrails

- No `.env`-at-root loader shared across workers — wrangler's `.dev.vars`
  per-worker model is the platform convention; the per-worker seeders are the
  sharing mechanism.
- Root orchestration goes through `vp run -r <task>`, not ad-hoc bash chains.
- `seed` is never cached (`cache: false`) — it talks to live local/dev-stack
  state.
- Solo-mode is not the default dev path — schema changes and cross-worker
  flows need the local fleet (`bun run dev`).

## 7. Operational checks

- `vp run -r db:migrate:local --last-details` (or `-v`) shows HIT/MISS per
  task; adding a migration file to one worker re-runs only that worker's
  task.
- The portal journey (per the `interactive-test` skill,
  `.agents/skills/interactive-test/SKILL.md`) works after `bun run seed`:
  `alice`/`bob`/`dave` demo users and the `acme`/`beta` demo orgs are intact.
- Solo-mode: with only guestlist running via `dev:solo` and a valid
  `CLOUDFLARE_API_TOKEN`, a request that crosses its promoter/roadie bindings
  reaches the staging workers (verify via staging logs/responses).
- CI: `.rwx/ci.yml`'s `bootstrap` step stays fast and carries no `.wrangler`
  state into later layers.

## 8. References

- Harness engineering: https://openai.com/index/harness-engineering/
- vp tasks/caching: https://viteplus.dev/guide/run, https://viteplus.dev/guide/cache
- Files: `scripts/dev-config.ts`, `scripts/dev-stack.ts`, `scripts/dev-solo.ts`,
  `workers/*/scripts/env-init.ts`, `workers/{guestlist,store}/scripts/seed.ts`,
  root `package.json`, `.rwx/ci.yml`, `docs/ops/env-vars.md`.
- Remote bindings: developers.cloudflare.com/workers/development-testing/
