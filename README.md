# somewhatintelligent

A personal platform monorepo on Cloudflare Workers. Six deployable workers
share one identity layer and one config surface:

- **bouncer** — single public ingress; owns every hostname, refreshes
  sessions, mints a signed attestation envelope, and dispatches to the other
  workers via service binding.
- **guestlist** — central auth service (Elysia + Better Auth + D1); the sole
  session authority.
- **identity** — sign-in / account UI (TanStack Start), mounted under
  `/account`.
- **store** — storefront app (TanStack Start), mounted under `/shop`.
- **roadie** — R2-backed blob/media storage broker (Workers RPC + cron).
- **promoter** — outbound comms and deferred work: queue consumer for email
  (Resend today), plus cron jobs.

Everything is TypeScript, built on Bun + Vite+ (`vp`), deployed with
wrangler.

## Live

- Production: [https://somewhatintelligent.ca](https://somewhatintelligent.ca)
  (+ `www.somewhatintelligent.ca`)
- Staging: [https://staging.somewhatintelligent.ca](https://staging.somewhatintelligent.ca)

## Quick start

```sh
bun install
bun run dev     # one command: cached prep (env:init + local D1 migrations),
                # then guestlist + identity + roadie
bun run seed    # first boot: demo users/orgs, pre-verified logins
```

Subsets and single workers work the same way:

```sh
bun run dev guestlist identity         # any subset of the fleet
cd workers/<name> && bun run dev       # one worker from its own directory
cd workers/<name> && bun run dev:solo  # one worker, bindings -> staging fleet
```

Tests:

```sh
bun run test       # workspace-wide vitest
bun run test:e2e   # Playwright e2e
```

See `.agents/skills/interactive-test/SKILL.md` for the local-dev operating
manual (boot, agent-browser sign-in recipe, test tiers) and
`.agents/skills/write-tests/SKILL.md` for which tier a new test belongs in.

## CI/CD

CI/CD runs on RWX (`.rwx/`): `ci.yml` gates every PR and, on push to `main`,
promotes the changed workers straight to staging; `preview.yml` builds a
preview per PR; `release-please.yml` maintains a per-worker release PR, and
merging it tags and deploys the affected workers to production; `release.yml`
is a manual per-worker re-ship dispatch; `deploy.yml` is the shared,
env-parameterized fleet deploy the other workflows call into.

## Rebranding

Product identity and platform identity are deliberately separate. The current
somewhatintelligent visual system, reference imagery, and implementation brief
live in
[`docs/design/somewhatintelligent-brand-study/HANDOFF.md`](docs/design/somewhatintelligent-brand-study/HANDOFF.md).

The platform identity is configured in these files:

| File                                | What lives here                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `packages/config/src/brand.ts`      | brand `{name, short, supportEmail}`; cookie prefix; auth `{providerId, passkeyRpName, twoFactorIssuer}` |
| `packages/config/src/deploy.ts`     | base domain, dev domain, worker-name prefix, Cloudflare account ID                                      |
| `workers/identity/src/app-brand.ts` | per-app product name (each app is a different product)                                                  |

Visual-system changes belong in `packages/design` (color, typography, radius,
and generated CSS) and the allowlisted brand surface in
`packages/ui/src/components/ui/logo/brand.ts`. Do not scatter visual identity
through feature components.

Per-env D1 IDs, routes, domains, and resource names live directly in each
worker's checked-in `wrangler.jsonc` (top level = staging, `env.production` =
production). After editing a `wrangler.jsonc` or `deploy.ts`, regenerate that
worker's types with `bun run types` from its directory.

## Where to read next

- [`docs/README.md`](docs/README.md) — full documentation index.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — C4-style architecture
  reference: context, containers, components, shared patterns.
- [`docs/runbooks/`](docs/runbooks) — operational runbooks (production
  deploys, secrets, roadie R2 provisioning).
