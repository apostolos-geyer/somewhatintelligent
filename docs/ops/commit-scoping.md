# Commit scoping — how a PR title becomes a release

Conventional commits with a WORKER scope are not a style preference here —
**they are the release mechanism**. This repo squash-merges, so the PR title
becomes the main-branch commit message; release-please (manifest mode, one
component per worker) parses exactly those messages to decide **which worker's
version bumps** and what lands in its CHANGELOG. CI's `pr-title-lint`
(`.rwx/ci.yml`) rejects non-conforming titles, because an unparseable title
contributes NOTHING to versioning — the change ships to staging but can never
be released to production on its own.

```
type(scope): description
```

- `type`: `feat` `fix` `chore` `docs` `refactor` `perf` `test` `ci` `build`
  `revert`. `feat` bumps minor, `fix`/`perf` bump patch, a `!` or
  `BREAKING CHANGE:` footer bumps major; the full mapping lives in
  `release-please-config.json` (`changelog-sections`).
- `scope`: the worker the change ships to (table below). Cross-cutting
  changes use the MOST AFFECTED worker's scope, or `repo` when there is no
  single worker.

## Valid scopes

| Scope       | Release-please component                  | What it covers                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bouncer`   | `workers/bouncer` (tags `bouncer-v*`)     | The public router                                                                                                                                                                                                                                                                                                                                                 |
| `guestlist` | `workers/guestlist` (tags `guestlist-v*`) | Auth server + org/admin API                                                                                                                                                                                                                                                                                                                                       |
| `identity`  | `workers/identity` (tags `identity-v*`)   | The `/account` app                                                                                                                                                                                                                                                                                                                                                |
| `roadie`    | `workers/roadie` (tags `roadie-v*`)       | Blob/R2 service                                                                                                                                                                                                                                                                                                                                                   |
| `promoter`  | `workers/promoter` (tags `promoter-v*`)   | Email service                                                                                                                                                                                                                                                                                                                                                     |
| `store`     | `workers/store` (tags `store-v*`)         | The `/shop` storefront                                                                                                                                                                                                                                                                                                                                            |
| `publisher` | `workers/publisher` (tags `publisher-v*`) | Publisher service — texts, software records, and fixed pages (RFC-0001)                                                                                                                                                                                                                                                                                           |
| `site`      | `workers/site` (tags `site-v*`)           | Astro public site — SSR worker rendering Publisher/Store read models per RFC-0001                                                                                                                                                                                                                                                                                 |
| `operator`  | **none — deliberately**                   | Operator console — the Access-protected admin app on its own `desk.*` hostname, outside Bouncer (RFC-0001). A valid SCOPE for changes under `workers/operator/`, but like `inbox` it has **no release-please component and no CI lane**: it deploys manually (`cd workers/operator && bun run deploy:staging` / `deploy:production`) and is versioned informally. |
| `inbox`     | **none — deliberately**                   | The vendored standalone mail app (`inbox/`). A valid SCOPE for changes under `inbox/`, but it has **no release-please component and no CI lane**: it deploys manually (`cd inbox && bun run deploy`) and is versioned informally.                                                                                                                                 |
| `repo`      | none                                      | Cross-cutting / CI / docs / tooling with no single worker                                                                                                                                                                                                                                                                                                         |

**Packages convention** (`packages/*` — kit, auth, config, ui, …): shared
packages have no components of their own. Scope a package change by the
worker it changes _behavior in_ — `fix(guestlist): …` for an auth-factory fix
that manifests in guestlist — because that is the worker whose version must
bump for the fix to reach production. A package change that genuinely affects
the whole fleet is `feat(repo): …`/`chore(repo): …` and then **each worker
that must ship it needs a scoped commit (or a release-please
`Release-As`/manual bump)** before production picks it up; staging always
picks it up on merge regardless, since `changed-workers.sh` fans `packages/*`
out to every worker.

Multi-worker titles are valid when a change really lands in several:
`feat(guestlist,identity): …` — release-please bumps each named component.

## Definition of done — the owner's stance

From [`docs/definition-of-done.md`](../definition-of-done.md), applied to this
pipeline:

**Code merges only deploy-ready.** A PR that is not safe to be serving
traffic minutes after merge is not ready to merge — there is no "merge now,
stabilize later" lane. Merging IS shipping to staging (`.rwx/ci.yml` gate →
promote-on-merge), so a red or half-done change on main is a broken staging
by construction.

**Apps go live when they finish — never parked.** When a worker's work is
verified on staging, the production release is cut immediately: merge the
Release PR (or let it accumulate ONLY what is still being verified). A
finished feature sitting unreleased on main is the failure mode this pipeline
exists to prevent — staging promotes on merge, and the production release
follows verification without delay.

## Mechanics recap

1. PR merged with `feat(store): checkout flow` → squash commit
   `feat(store): checkout flow` on main.
2. Gate runs; staging promotes the changed workers.
3. release-please updates the Release PR: `store` moves e.g. 0.1.0 → 0.2.0
   with the changelog line.
4. Merging that Release PR cuts `store-v0.2.0` and deploys ONLY the released
   workers to production, canonical order, migrate-before-code
   (`.rwx/release-please.yml`).
5. Rollback / re-ship: `rwx dispatch si-reship-worker --param worker=store
--param tag=store-v0.1.0` (`.rwx/release.yml`).

See [`docs/ops/rwx-setup.md`](rwx-setup.md) for activation status and
`.agents/skills/release/SKILL.md` for the operational levers.
