# Notes for Claude Code

This is a **template fork** of a personal platform monorepo. The platform
spine — bouncer, guestlist, roadie, promoter, identity, store, and supporting
packages — runs locally. Per-client rebranding is centralized into a small
set of declared brand surfaces — see "Where to edit when rebranding" below.

## Where to edit when rebranding

`packages/design`, `packages/ui`, and `workers/identity` are scaffolded from
platform's copy-owned templates (`docs/rfc` upstream; see the
`<!-- scaffold:* -->` sections below) and carry their **own** brand surfaces,
separate from `@si/config`:

| File                                          | What lives here                                                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/design/src/tokens/brand.ts`         | palette ramps (`neutralRamp`/`accentRamp`), semantic palette values (`lightPalette`/`darkPalette`/`functionalColors`) — the design system's colors |
| `packages/ui/src/components/ui/logo/brand.ts` | logo wordmark strings, aria-label, mark geometry/colors (OG-safe hex)                                                                              |
| `workers/identity/src/app.config.ts`          | identity's brand name/short/supportEmail, and the bouncer attestation public-key set                                                               |
| `workers/identity/src/app-brand.ts`           | identity's own `APP_PRODUCT_NAME` (shown after the wordmark)                                                                                       |

`@si/config` remains the brand surface for every OTHER consumer (guestlist,
bouncer, store, promoter, the auth package, email templates):

| File                            | What lives here                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/config/src/brand.ts`  | brand.{name, short, supportEmail}; cookies.prefix; auth.{providerId, passkeyRpName, twoFactorIssuer} — read by guestlist, bouncer, store, promoter, packages/auth, packages/email (`short`/`supportEmail` currently have no reader since identity switched to its own app.config.ts) |
| `packages/config/src/deploy.ts` | baseDomain, devDomain, workerPrefix, cloudflareAccountId (code-consumed values only; per-env D1 ids, routes, domains, and resource names live directly in each worker's `wrangler.jsonc`)                                                                                            |

**Do not** scatter brand/domain/cookie literals through code. Anything new
that needs branding reads from `@si/config` (or from the app's local
`app-brand.ts`/`app.config.ts` if it's per-app product information), UNLESS
the code lives in `packages/design`, `packages/ui`, or `workers/identity` —
those read only from their own brand surfaces above (see the `TODO.md`
dependency-wiring note and the `<!-- scaffold:* -->` sections below for the
templates' own conventions).

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
`scripts/env-init.ts`; the D1/queue/DO/AE local sims key on names, not remote
ids. After editing a `wrangler.jsonc` or `packages/config/src/deploy.ts`,
regenerate per-service worker types: `cd <service> && bun run types`.

## Code consumers that read `@si/config`

Whenever something new needs the brand name / cookie prefix / provider id,
import from `@si/config` rather than introducing a literal:

- `workers/guestlist/src/auth-config.ts` — cookiePrefix, providerId,
  passkeyRpName, twoFactorIssuer, trustedOrigins (derived from env.AUTH_DOMAIN)
- `workers/guestlist/src/index.ts` — CORS regex built from baseDomain/devDomain
- `workers/bouncer/src/session.ts` — session_token cookie name
- `packages/auth/src/server.ts` — allowedHosts, cookiePrefix per-app, providerId;
  `*.{apex}` trustedOrigins (cross-subdomain callbackURL trust)
- `workers/identity/src/lib/return-to.ts` — post-auth `returnTo` open-redirect guard.
  Trusts the apex + every subdomain of `AUTH_DOMAIN` (a `.{baseDomain}` /
  `.{devDomain}` var rendered into identity's wrangler vars, allowlisted into the
  bundle by `vite.config.ts` CLIENT_VARS). No per-app origin list to maintain —
  any host under the apex is trusted by construction, mirroring the auth
  server's `*.{apex}` trustedOrigins. (Reads `AUTH_DOMAIN` from the wrangler
  var directly, not from `@si/config` — listed here for the trust-boundary
  contract, not the import.)

Identity's own wordmark/logo rendering (`src/components/guestlist-brand.tsx`,
`og/_brand.tsx`) and `packages/ui`'s `logo.tsx`/`logo-animated.tsx` no longer
read `@si/config` — they're scaffolded-template brand surfaces now (see
"Where to edit when rebranding" above).

## Local dev workflow

> **The local-dev operating manual** is the `/interactive-test` skill
> (`.agents/skills/interactive-test/SKILL.md`): boot, the agent-browser
> sign-in recipe, and the test tiers (`bun run test` · `bun run test:e2e`).
> See also `.agents/skills/write-tests/SKILL.md` for which tier a new test
> belongs in.

```sh
bun install                 # -> typecheck + per-worker tests work immediately
bun run dev                 # ONE command: cached prep (env:init + local D1
                            #   migrations), then guestlist+identity+roadie
bun run seed                # first boot: demo users/orgs (pre-verified logins)

bun run dev guestlist identity         # any subset of workers
cd workers/<name> && bun run dev       # or one worker from its own directory
cd workers/<name> && bun run dev:solo  # one worker against the STAGING fleet
                                       #   (needs CLOUDFLARE_API_TOKEN or wrangler login)
```

Local dev is dev-direct (no bouncer in front — `docs/ARCHITECTURE.md` §4.5).
The dev registry is per-worktree (`.wrangler/dev-registry`, path derived by
each entry point), inspectors are off by default, and `GUESTLIST_PORT` /
`ROADIE_PORT` shift the listeners — so parallel worktrees run tests and
per-worker dev side by side; the `*.somewhatintelligent.localhost` HTTPS journey is
one worktree at a time (machine-global proxy + hostnames).

## Things to know

- **Bouncer's route table is single-host per env** (`workers/bouncer/wrangler.jsonc`
  `vars.ROUTES`, schema + dispatch in `src/routes.ts` / `src/index.ts` /
  `src/proxy.ts`): staging is `staging.somewhatintelligent.ca`, production is
  `somewhatintelligent.ca` + `www.somewhatintelligent.ca`. Six mounts share
  each host — `/api` → guestlist (`passthrough`), `/account` → identity and
  `/shop` → store (both `vmf`: bouncer strips the mount prefix before
  forwarding and rewrites asset paths / redirect Location / Set-Cookie paths
  on the way back — see `handleMountedApp`), `/_sfn/store` → store and
  `/_sfn/account` → identity (`passthrough` — see below), `/` → a redirect
  (mode `"redirect"`, no upstream binding) to `/shop`. Route modes are
  enforced per `(host, mount)`, not per host, so passthrough/vmf/redirect can
  share one host as long as they don't own the same mount. **The vmf
  client-side contract** (vmf rewrites HTTP-layer responses but cannot reach
  a hydrated SPA's history/link state) is closed by two pieces working
  together: (1) bouncer's `MountMetaInjector` announces the mount via
  `<meta name="si-mount">`, and each app feeds it to a TanStack Router
  `rewrite` pair (`mountRewrite` in `workers/*/src/lib/basepath.ts` — NOT the
  `basepath` option, which TanStack Start clobbers on both server and client
  with its own `TSS_ROUTER_BASEPATH` define); (2) each app compiles a unique
  server-fn base (`tanstackStart({ serverFns: { base: "/_sfn/<app>" } })` in
  its vite.config.ts) because Start's client calls server fns at the APEX,
  outside the mount — bouncer passes those paths through unstripped to the
  owning worker. Full detail in the P1 decision log in
  `docs/exec-plans/completed/0001-greenfield-bootstrap.md`.
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
  the per-file checker) — `vp check` inside `workers/guestlist` returns 251
  errors, for example. Treat workspace-wide `bun run check` from root as the
  reference signal; the `src/` tree is clean.
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
  one. **The full scoping guide (valid-scope table, packages convention,
  release mechanics, definition-of-done stance) is
  [`docs/ops/commit-scoping.md`](docs/ops/commit-scoping.md)**;
  `.github/PULL_REQUEST_TEMPLATE.md` carries the format.
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

## Skill loading

<!-- intent-skills:start -->

Before substantial work:

- Skill check: run `vpx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `vpx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.

<!-- intent-skills:end -->

<!-- scaffold:design -->

# Design system (scaffolded from platform templates/design)

- **Rebranding**: edit `packages/design/src/tokens/brand.ts` (palette ramps,
  semantic palette values, fonts), then `bun run codegen` and
  `bun run audit:contrast`. Components never change during a reskin — if a
  rebrand diff touches anything outside the brand surfaces, that is a bug.
- **Two token layers**: the palette (yours, open-ended — add custom tokens
  for marketing surfaces freely) and the semantic layer
  (`primary`, `foreground`, `destructive`, … — a fixed contract UI
  components compile against). App code may use declared palette tokens;
  UI-kit components must stay semantic-only.
- **`bun run brand-lint <dirs>`** enforces this: no hex literals outside
  brand surfaces, no unknown color utilities, `--strict-semantic` for the
  ui package. Wire it into your check pipeline.
- Generated CSS lives in `generated/` — regenerate via codegen, never
  hand-edit.

<!-- scaffold:ui -->

# UI kit (scaffolded from platform templates/ui)

- shadcn-style components on Base UI: **copy-owned** — edit freely, there
  is no upstream dependency to fight.
- **Components stay semantic**: only semantic design tokens
  (`bg-primary`, `text-foreground`, `border-border-strong`, …) and semantic
  variant names (`primary/secondary/destructive/success/warning/inverse`)
  in this package. Brand-named tokens or strings here break the reskin
  contract (`brand-lint --strict-semantic` gates it).
- **Adding components**: `bunx shadcn add <name>` works (`components.json`);
  stock shadcn output is already semantic — restyle to the house materials
  (`lib/materials.ts`) as wanted, keep it semantic.
- **The logo mark and wordmark** live in `src/components/ui/logo/brand.ts`
  — the one brand-edited file in this package (hex literals there are
  required by the OG/satori pipeline and are allowlisted).

<!-- scaffold:identity -->

# Identity app (scaffolded from platform templates/identity)

- The IdP surface: auth flows (sign-in/up, reset, verify, two-factor,
  consent, device), account self-service, and the org/user admin group.
  Data layer is typed RPC on the `GUESTLIST` service binding.
- **Brand surfaces**: `src/app.config.ts` (names, support email,
  attestation keys), the ui package's logo `brand.ts`, `og.config.ts`
  (OG fonts). A reskin touches only these plus the design package.
- **Analytics is a no-op stub** (`src/lib/analytics.ts`) — swap in your
  vendor there; event names are typed.
- Some org-admin actions are feature-flagged off (`ORG_ADMIN_FEATURES`)
  pending guestlist entrypoint methods (`adminUpdateOrg`,
  `adminResendOrgInvitation`).
- Tests: `bun run test` (unit + jsdom DOM suites). `bun run types` after
  wrangler edits; repoint the GUESTLIST service names to your fleet.
