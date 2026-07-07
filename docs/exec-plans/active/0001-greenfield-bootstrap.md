# 0001 — Greenfield bootstrap of the somewhatintelligent platform

Status: ACTIVE
Started: 2026-07-07
Base: verbatim import of greenroom@075f3bf (commit 723d40a)

## Why

The `somewhatintelligent` Instagram account needs a store (a shirt went
viral) and, behind it, a platform: a simple subscription system that can
later gate more apps, using the IG account as the funnel. This repo is the
new home for all somewhatintelligent infrastructure. It inherits the most
active platform spine (greenroom), borrows the storefront (apostoli.ca),
the Stripe IaC pattern (HiPat.app), and the mail app (agentic-inbox) —
pruning dead weight and applying accumulated harness learnings at each step.

## Target state

- **Apps**: `workers/store` (storefront, `/shop`) + `workers/identity`
  (`/account`) behind `workers/bouncer` on `somewhatintelligent.ca`.
- **Routing** (bouncer `vars.ROUTES`, single host per env):
  - `/api` → guestlist, `/account` → identity, `/shop` → store,
    `/` → redirect to `/shop`.
  - Staging mirror on `staging.somewhatintelligent.ca`, protected by
    Cloudflare Access.
- **Mail**: vendored agentic-inbox SI instance at
  `mail.somewhatintelligent.ca` (worker `agentic-inbox-si`), deploys
  separately, NOT integrated with platform auth — Cloudflare Access only.
- **Stripe**: `packages/stripe` IaC (HiPat pattern: metadata-tagged
  idempotent sync, offline stub generation). One tier: `member`
  (`member_monthly`, placeholder price). `@better-auth/stripe` wired in the
  auth factory but enabled only when `STRIPE_SECRET_KEY` exists.
  **No storefront↔Stripe integration yet** — checkout keeps the manual
  pending/paid stub.
- **Provisioning**: idempotent Cloudflare SDK scripts (`scripts/provision/`)
  for tokens, D1, R2+CORS, Access apps + service token, Email Routing,
  staging test users. Input: an API token with token-creation perms + account id.
- **CI/CD**: RWX (greenroom lanes renamed), scaffolded but inert until the
  RWX GitHub App + vaults are configured (runbook in docs/ops). Per-worker
  GitHub deploy records carry Cloudflare-dashboard and live-URL links.
- **Version strings** rendered in every app (UI footer) and `/__version`
  on API workers.
- **Design system**: monochrome + rounded, zero box-shadow/blur; depth via
  solid/dashed/dotted borders — blueprint/diagram aesthetic. Iosevka stays.

## Decision log

| #   | Decision                                                                                                                                      | Why                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Verbatim import first, prune second                                                                                                           | User-specified; keeps a reviewable trail                                                    |
| 2   | Iosevka fonts kept in full                                                                                                                    | Owner uses the font; fits blueprint aesthetic                                               |
| 3   | No Stripe in storefront checkout yet                                                                                                          | Owner will handle products/pricing separately                                               |
| 4   | Apex `/` redirects to `/shop`; `marketing` worker pruned                                                                                      | Default (owner may override); IG-funnel store needs no marketing site                       |
| 5   | Org/multi-tenancy plugin stays wired                                                                                                          | Default; stripping is schema surgery for no near-term gain                                  |
| 6   | Package scope `@greenroom/*` → `@si/*`, workerPrefix `si`                                                                                     | Short, collision-free                                                                       |
| 7   | Cloudflare account `c735c5a53d864bee37400befb7f4c7f4` (personal); zone `somewhatintelligent.ca` = `777506a7cc42ec22ffafce16b3d36d06` (active) | Verified live 2026-07-07                                                                    |
| 8   | Root `vp test` shows 39 file-level parse failures with all tests passing — identical in greenroom source                                      | Pre-existing quirk; per-package suites (CI gate) are the reference: 414 passing at baseline |

## Phases

- **P0** (done when this doc lands): verbatim import, green baseline
  (typecheck 15/15, per-package tests 7/7 suites), pushed.
- **P1**: rebrand (brand.ts / deploy.ts / app-brand.ts / `@si/*` scope) +
  prune (sprout, marketing, docs/sprout, e2e/sprout, marketing-videos,
  RealtimeKit, PDFs) + bouncer route table rewrite. Gates green after.
- **P2** parallel tracks (worktree-isolated agents; merge small→large,
  design last): A storefront port · B Stripe IaC · C inbox vendor ·
  D provisioning suite · E RWX/release engineering + version strings ·
  F design system.
- **P3**: live staging provisioning + deploy (fleet order: promoter roadie
  guestlist identity store bouncer; + inbox), Access, seed users, smoke +
  browser walk.
- **P4**: harness docs rewrite (commit scoping for per-worker
  release-please, RWX activation checklist), final gates, push.

## Commit conventions (release-please)

Squash-merge titles and commits MUST be conventional commits scoped to the
worker they touch (`feat(store): …`, `fix(bouncer): …`) — release-please
versions each worker from those scopes. Cross-cutting changes use the most
affected worker's scope or `chore(repo): …`.
