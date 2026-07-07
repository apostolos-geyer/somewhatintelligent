# Platform Template

An identity-first platform spine — ingress bouncer, central auth service,
R2-backed storage broker, deferred-work runner, sign-in/account UI, and the
cross-cutting packages they share. The spine is designed to be **forked per
client**: rebranding is editing three TypeScript files and running one
script.

## Layout

```
platform-template/
├── workers/
│   ├── bouncer      # Single ingress Worker — owns public hostnames,
│   │                # refreshes session, dispatches to apps via service binding
│   ├── guestlist      # Central auth service (Elysia + Better Auth + D1)
│   ├── roadie       # R2-backed blob storage broker (Workers RPC + cron)
│   ├── promoter     # Deferred-work runner (Workers RPC + cron)
│   └── identity      # Sign-in / account UI (TanStack Start, CF Workers)
├── packages/
│   ├── audio         # WebAudio primitives (consumed by ui's file-preview)
│   ├── auth          # Shared Better Auth client config
│   ├── config        # Central platform config — single source of truth
│   ├── design        # Design tokens (CSS vars)
│   ├── email         # Transactional email templates (React Email)
│   ├── kit           # canonical-log, request-context ALS, ULID factory,
│   │                 # TanStack Start auth provider, service-client factories
│   ├── og            # Build-time OG image pipeline (satori + resvg)
│   ├── ui            # React component library (Base UI + Tailwind)
│   └── typescript-config
└── scripts/
    ├── dev-config.ts        # local-dev defaults consumed by worker env-init.ts seeders
    └── dev-solo.ts          # one worker local, staging fleet via remote bindings
```

Not part of the bun workspace above: `marketing-videos/` (Remotion) and
`inbox/` (a vendored, standalone Agentic Inbox instance — its own
package.json/lockfile/wrangler.jsonc, deployed separately as Worker
`agentic-inbox-si`) are self-contained sibling projects with their own
tooling; root scripts don't reach into them.

## Architecture

```
                    ┌─────────────────────────────────────────────┐
                    │  bouncer (CF Worker, single public ingress) │
   User ───────────►│  - resolves session via guestlist             │
                    │  - mints signed attestation envelope        │
                    │  - dispatches to apps via service binding   │
                    └────┬────────────────────────────────┬───────┘
                         │ service binding                │ service binding
                         ▼  (+ x-platform-att envelope)   ▼
                    ┌──────────┐                     ┌──────────────────────┐
                    │  Any App │  ──── service ─────►│  guestlist (Better     │
                    │ (own DB) │       binding       │  Auth + D1, IDP)     │
                    └──────────┘    (fallback +      └──────────────────────┘
                                     admin RPC)         │           │
                                                        ▼           ▼
                                                  ┌──────────┐  ┌──────────┐
                                                  │  roadie  │  │ promoter │
                                                  │ (R2)     │  │ (email)  │
                                                  └──────────┘  └──────────┘
```

- **Bouncer** owns every public hostname; app workers have `workers_dev: false`
  and no Custom Domains. Reached only via bouncer.
- **Guestlist** is the single session authority and sole holder of
  `BETTER_AUTH_SECRET`. Apps call it over service binding; user-facing auth
  flows route to `workers/identity` (sign-in, account, admin) and come back via
  `?returnTo=…`.
- **Apps trust bouncer's Ed25519-signed attestation envelope** for session
  identity (id, role, name, email, image). The verifier is in
  `@si/auth`; rejection of missing/invalid envelopes is mandatory in
  production and falls back to guestlist in development for the dev-direct
  topology (running an app alone without bouncer in front).

The full architecture reference, including diagrams, lives in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ([PDF](docs/ARCHITECTURE.pdf)).

## Rebranding for a new fork

Three files own the entire surface:

| File                                | What lives here                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config/src/brand.ts`      | Brand name, short wordmark, support email, cookie prefix, auth `providerId`, passkey RP name, 2FA issuer                                                                           |
| `packages/config/src/deploy.ts`     | Base domain, dev domain, worker-name prefix, Cloudflare account ID (code-consumed values; per-env D1 IDs, routes, and domains now live directly in each worker's `wrangler.jsonc`) |
| `workers/identity/src/app-brand.ts` | This app's product name (each app declares its own — they're different products)                                                                                                   |

The `wrangler.jsonc` files are checked-in source (top level = staging,
`env.production` = production) — edit them directly to change per-env deploy
resources; there is no render step. After editing `deploy.ts`, regenerate the
worker types that read it:

```sh
cd workers/guestlist && bun run types    # regenerate worker-configuration.d.ts
cd workers/bouncer && bun run types
cd workers/roadie && bun run types
cd workers/promoter && bun run types
cd workers/identity && bun run types
```

### Cloudflare resources you need to provision per fork

- D1 databases — `wrangler d1 create guestlist-<env>-db`, `wrangler d1 create roadie-<env>-db`,
  paste the returned IDs into the `database_id` fields of each worker's `wrangler.jsonc`.
- R2 bucket — `wrangler r2 bucket create roadie-<env>-blobs`. Paste your CF
  account ID into `packages/config/src/deploy.ts` and each `wrangler.jsonc`.
- `wrangler login` once per machine.

## Quick start

```sh
bun install
bun run dev               # one command: cached prep (env:init + local D1 migrations),
                          # then guestlist + identity + roadie
bun run seed              # demo users/orgs — run once dev is up;
                          # logins incl. super@user.com / superuserdo (pre-verified)
```

Subsets and single workers work the same way:

```sh
bun run dev guestlist identity       # any subset of the fleet
cd workers/<name> && bun run dev     # one worker from its own directory
cd workers/<name> && bun run dev:solo  # one worker, bindings → deployed STAGING fleet
```

Local dev URLs (dev-direct — no bouncer locally; `docs/ARCHITECTURE.md` §4.5):

| Surface                    | URL                                              |
| -------------------------- | ------------------------------------------------ |
| Identity (sign-in/account) | `https://identity.somewhatintelligent.localhost` |

## Email verification in local dev

All `bun run seed` users are created pre-verified — sign in with them
directly. Email verification only gates **brand-new sign-ups**, and only in
production (`requireEmailVerification: env.ENVIRONMENT === "production"` in
`workers/guestlist/src/auth-config.ts`); real verification emails go through
`workers/promoter` → [Resend](https://resend.com) and need a `RESEND_API_KEY`
in `workers/promoter/.dev.vars`.

## Toolchain

This template uses [Vite+](https://github.com/voidzero-dev/vite-plus) (`vp`)
on top of Bun, Cloudflare Workers + D1 + R2 (via wrangler + miniflare locally),
and [portless](https://github.com/portless/portless) for wildcard local HTTPS.

```sh
bun run check          # workspace-wide lint + format + typecheck
bun run test           # workspace-wide vitest
```

Note: `vp check` reports many pre-existing typecheck warnings inside `__tests__/`
(vitest globals not visible to the per-file checker). These are an inherited
vp tooling quirk shared with the source repo, not regressions. The `src/`
tree is clean; runtime is verified e2e.

## What's deliberately not here

- SCIM, SAML. Multi-tenancy IS wired (better-auth `organization` plugin,
  org/member/invitation tables, identity admin UI); SCIM would build on its
  hooks as a separate guestlist plugin when an enterprise customer needs it.
- Anything not consumed by the shipped apps (guestlist, identity).

## Where to read next

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ([PDF](docs/ARCHITECTURE.pdf))
  — C4-style reference: context, containers, components, shared patterns
  (security, sessions, cross-worker comms, dev/prod parity, WebSockets,
  logging), config + secrets.
- [`docs/adding-an-app.md`](docs/adding-an-app.md) — step-by-step for adding
  a new TSS or non-Start app.
- [`docs/secrets.md`](docs/secrets.md) — secret rotation runbooks.
