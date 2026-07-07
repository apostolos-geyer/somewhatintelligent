# Notes for Claude Code

This is a **template fork** of a personal platform monorepo. The platform
spine — bouncer, guestlist, roadie, promoter, identity, and supporting
packages — runs locally. Per-client rebranding is centralized into three
files.

## Where to edit when rebranding

| File                                | What lives here                                                                                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config/src/brand.ts`      | brand.{name, short, supportEmail}; cookies.prefix; auth.{providerId, passkeyRpName, twoFactorIssuer}                                                                                          |
| `packages/config/src/deploy.ts`     | baseDomain, devDomain, workerPrefix, cloudflareAccountId (code-consumed values only; per-env D1 ids, routes, domains, and resource names now live directly in each worker's `wrangler.jsonc`) |
| `workers/identity/src/app-brand.ts` | per-app `APP_PRODUCT_NAME` (each app is a different product)                                                                                                                                  |

**Do not** scatter brand/domain/cookie literals through code. Anything new
that needs branding reads from `@greenroom/config` (or from the app's local
`app-brand.ts` if it's per-app product information).

## How wrangler config works

Each worker has **one checked-in `wrangler.jsonc`** (source, not generated):
the **top level is staging**, and the single **`env.production`** block is the
production deploy. There is no separate `env.staging` — `wrangler deploy` (no
`--env`) ships staging; `wrangler deploy --env production` ships production.
Named envs do not inherit bindings, so `env.production` re-declares everything
it needs (`name`, vars, d1, services, queues, DO+migrations, routes,
observability, …).

Local dev runs against the staging top level with **`.dev.vars` overrides**
(`ENVIRONMENT=development`, local URLs, dev secrets) seeded by each worker's
`scripts/bootstrap.ts`; the D1/queue/DO/AE local sims key on names, not remote
ids. After editing a `wrangler.jsonc` or `packages/config/src/deploy.ts`,
regenerate per-service worker types: `cd <service> && bun run types`.

## Code consumers that read `@greenroom/config`

Whenever something new needs the brand name / cookie prefix / provider id,
import from `@greenroom/config` rather than introducing a literal:

- `workers/guestlist/src/auth-config.ts` — cookiePrefix, providerId,
  passkeyRpName, twoFactorIssuer, trustedOrigins (derived from env.AUTH_DOMAIN)
- `workers/guestlist/src/index.ts` — CORS regex built from baseDomain/devDomain
- `workers/bouncer/src/session.ts` — session_token cookie name
- `packages/auth/src/server.ts` — allowedHosts, cookiePrefix per-app, providerId;
  `*.{apex}` trustedOrigins (cross-subdomain callbackURL trust)
- `packages/auth/src/components/sign-in-card.tsx` — providerId + button label
- `workers/identity/src/lib/return-to.ts` — post-auth `returnTo` open-redirect guard.
  Trusts the apex + every subdomain of `AUTH_DOMAIN` (a `.{baseDomain}` /
  `.{devDomain}` var rendered into identity's wrangler vars, allowlisted into the
  bundle by `vite.config.ts` CLIENT_VARS). No per-app origin list to maintain —
  any host under the apex (incl. Sprout's `*.sprout.<apex>` brand portals) is
  trusted by construction, mirroring the auth server's `*.{apex}` trustedOrigins.
- `workers/identity/src/components/guestlist-brand.tsx` — wordmark via Logo
- `workers/identity/og/_brand.tsx` — same, for OG image rendering
- `packages/ui/.../logo/logo.tsx` + `logo-animated.tsx` — wordmark text

## Local dev workflow

> **The local-dev operating manual is
> [`docs/sprout/10-local-stack-and-testing-runbook.md`](docs/sprout/10-local-stack-and-testing-runbook.md):**
> boot, topologies (full fleet / subsets / solo-vs-staging / parallel
> worktrees), the agent-browser sign-in recipe, and the three test tiers
> (`bun run test` · `bun run test:pool` · `bun run test:e2e`).

```sh
bun install                 # -> typecheck + per-worker tests work immediately
bun run dev                 # ONE command: cached prep (env:init + local D1
                            #   migrations), then guestlist+identity+sprout+roadie
bun run seed                # first boot: demo users/orgs/brands (pre-verified logins)

bun run dev sprout identity            # any subset of workers
cd workers/<name> && bun run dev       # or one worker from its own directory
cd workers/<name> && bun run dev:solo  # one worker against the STAGING fleet
                                       #   (needs CLOUDFLARE_API_TOKEN or wrangler login)
```

Local dev is dev-direct (no bouncer in front — `docs/ARCHITECTURE.md` §4.5).
The dev registry is per-worktree (`.wrangler/dev-registry`, path derived by
each entry point), inspectors are off by default, and `GUESTLIST_PORT` /
`ROADIE_PORT` shift the listeners — so parallel worktrees run tests and
per-worker dev side by side; the `*.sproutportal.localhost` HTTPS journey is
one worktree at a time (machine-global proxy + hostnames).

## Things to know

- **Browser automation is set up** (`docs/browser-automation.md`):
  **agent-browser** runs standalone locally (manages its own Chrome; one
  command at a time — concurrent/backgrounded calls wedge its daemon) or
  attaches over CDP to Playwright's Chromium in containers; **Playwright**
  specs run in `e2e/` (`bun run test:e2e`). Provision Playwright's Chromium
  (+ Linux OS libs) with `bun run browsers:install`; in cloud/ephemeral
  containers a SessionStart hook re-provisions automatically. Not wired into
  CI — manual only.
- **`vp check`** has a per-file vs workspace inconsistency that surfaces
  ~50–250 phantom errors inside `__tests__/` (vitest globals not visible to
  the per-file checker). This is identical in the source repo — `vp check`
  inside `workers/guestlist` returns 251 errors there too. Treat workspace-wide
  `bun run check` from root as the reference signal; the `src/` tree is clean.
- **`worker-configuration.d.ts`** is generated by `wrangler types`. After
  editing a `wrangler.jsonc` or `packages/config/src/deploy.ts`, run
  `bun run types` per service to refresh the typed Env shape.
- **Env vars have a contract table** — [`docs/ops/env-vars.md`](docs/ops/env-vars.md):
  name, consumer, dev/CI/staging+production source. A new env var is not done
  until it has a row there.
- **PR titles MUST be conventional commits** (`type(scope): description`) —
  squash merges make the title the main-branch commit message, and
  release-please versions each worker from those; CI's `pr-title-lint`
  rejects non-conforming titles. Scope with the worker touched when there is
  one. `.github/PULL_REQUEST_TEMPLATE.md` carries the format.
- **Seeded demo users are pre-verified** — sign in with them directly. Email
  verification only gates brand-new sign-ups (production-only gate), and real
  emails need `RESEND_API_KEY` in `workers/promoter/.dev.vars`.
- **Pre-commit hook WORKS — do not `--no-verify`**: `.githooks/pre-commit`
  puts the repo-local `node_modules/.bin` on PATH itself, and
  `scripts/staged-check.ts` already partitions test/`scripts/` files to
  format-only (the per-file test-globals quirk above never hits the hook).
  Commit normally and let `vp staged` run; it also re-stages its formatting
  fixes.
- **Roadie / R2 blob images** (brand hero/logo/product photos): making them
  render needs TWO independent things — see
  [`docs/runbooks/roadie-r2-provisioning.md`](docs/runbooks/roadie-r2-provisioning.md).
  (1) Every worker that binds `ROADIE` MUST set `"entrypoint": "Roadie"` +
  `"props": { "callerApp": "<app>" }` on the service binding (mirror
  `workers/guestlist/wrangler.jsonc`) — without it `readCallerApp`
  throws on _every_ roadie call (reads and uploads), so no image resolves.
  (2) Per env: an S3 keypair secret on roadie (`S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`, minted account-scoped from R2) **and** a bucket CORS
  policy (uploads are presigned browser-direct PUTs). `R2_BUCKET`/`R2_ACCOUNT_ID`
  are already rendered vars; only the keypair + CORS are per-env setup.

## Multi-tenancy (wired) + SCIM (not yet wired)

Multi-tenancy is wired: better-auth's `organization` plugin is enabled in
`packages/auth/src/server.ts` (which `workers/guestlist/src/auth-config.ts`
calls into), the org/member/invitation tables live
in `workers/guestlist/src/schema.ts`, guestlist exposes the operator-facing
`/admin/orgs/*` routes (`workers/guestlist/src/index.ts`), and `workers/identity`
ships the admin UI for managing orgs/members/invitations. SCIM is not wired —
build it as a separate guestlist plugin reading the org plugin's hooks once an
enterprise customer needs it.

## Skill loading (carried over)

<!-- intent-skills:start -->

Before substantial work:

- Skill check: run `vpx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `vpx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->
