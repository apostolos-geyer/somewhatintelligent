# Onboarding

Get from a fresh clone (or fork) of this template to a fully running local
dev environment, signed in to the identity app via agent-browser.

## Prerequisites

Every service runs on Cloudflare Workers locally via miniflare — no local
Postgres, no MinIO. Wrangler + portless cover the rest.

| Tool                   | Purpose                                                  | Install                                       |
| ---------------------- | -------------------------------------------------------- | --------------------------------------------- |
| **bun**                | Package manager + JS runtime                             | `curl -fsSL https://bun.sh/install \| bash`   |
| **vp** (Vite+)         | Unified toolchain                                        | `npm i -g vite-plus`                          |
| **portless**           | Wildcard local HTTPS (`*.somewhatintelligent.localhost`) | `npm i -g portless` + `portless trust`        |
| **wrangler**           | Cloudflare Workers CLI                                   | Installed per-package via the workspace       |
| **Cloudflare account** | For real D1/R2 + `wrangler login`                        | [cloudflare.com](https://www.cloudflare.com/) |

The portless daemon needs to run as root on port 443 the first time:

```sh
portless trust       # one-time CA trust
sudo portless proxy start --foreground --port 443 --https --wildcard
```

(Subsequent dev sessions reuse the running daemon.)

## Per-fork setup

Before first install, rebrand the template for your project. Three files:

1. `packages/config/src/brand.ts` — brand name, cookie prefix, providerId, etc.
2. `packages/config/src/deploy.ts` — base domain, dev domain, worker prefix,
   CF account ID. (Code-consumed values only. Per-env D1 ids, routes, and
   domains live directly in each worker's checked-in `wrangler.jsonc`.)
3. `workers/identity/src/app-brand.ts` — this app's product name.

Then provision the Cloudflare resources for your fork:

```sh
wrangler login
wrangler d1 create guestlist-staging-db        # paste each ID into that
wrangler d1 create guestlist-production-db      #   worker's wrangler.jsonc
wrangler d1 create roadie-staging-db
wrangler d1 create roadie-production-db
wrangler d1 create store-staging-db
wrangler d1 create store-production-db
wrangler r2 bucket create roadie-staging-blobs
wrangler r2 bucket create roadie-production-blobs
```

Paste each `database_id` into the `d1_databases` block of the owning worker's
`wrangler.jsonc` (top level = staging, `env.production` = prod). Local dev keys
on `database_name`, not the id, so the checked-in placeholder ids work for
kicking the tires locally without deploying anywhere.

## First-time bootstrap

From the repo root:

```sh
bun install
bun run bootstrap   # writes .dev.vars per service (env:init)
```

`bootstrap` runs `vp run -r env:init` — each package's own `scripts/env-init.ts`.
It writes `.dev.vars` per service if missing, with local dev defaults. That's
all it does: no migrations, no seeding. The `wrangler.jsonc` files are checked-in
source (no render step), so nothing has to be generated first.

Local D1 migrations and demo seeding are separate steps. `bun run dev` runs
migrations for you as cached prep on startup, so the usual path is just:

```sh
bun run dev     # env:init + local D1 migrations (cached), then boots the stack
bun run seed    # demo users/orgs/brands, once the stack is up (next section)
```

If you want to migrate without starting the stack, `bun run migrate` applies
the local D1 migrations on their own.

## Start dev

```sh
bun run dev
```

This one command (`bun scripts/dev-stack.ts`) runs the cached prep (env:init +
local D1 migrations), ensures the portless HTTPS proxy is up on `:443`, then
boots **guestlist + identity + roadie + store**, each exactly as its own
`cd workers/<name> && bun run dev`. Pass a subset to boot only those workers:

```sh
bun run dev guestlist identity   # any subset of workers/<name>
```

Or start a single worker directly from its directory:

```sh
cd workers/identity && bun run dev   # portless-registered (identity.somewhatintelligent.localhost)
cd workers/guestlist && bun run dev  # plain wrangler dev (:8787, reached via service binding)
```

guestlist and roadie are plain `wrangler dev` (reached over service bindings /
the dev registry, not a portless URL); identity and store are portless-registered
(each app's own `package.json` carries a `"portless"` key — there is no root
`portless.json`). Local dev is dev-direct: no bouncer runs locally (see
`docs/ARCHITECTURE.md` §4.5) — the `/account` and `/shop` vmf mounts only
exist on staging/production; identity and store each serve at their own root
here.

Local URLs:

| Component           | URL                                                    |
| ------------------- | ------------------------------------------------------ |
| Identity (UI)       | `https://identity.somewhatintelligent.localhost`       |
| Store (UI)          | `https://store.somewhatintelligent.localhost`          |
| Guestlist (service) | `http://localhost:8787` (service binding, no portless) |
| Roadie (R2)         | `http://localhost:8790` (service binding, no portless) |

## Seed demo data

Once the stack is up, seed the demo users, orgs, and brands:

```sh
bun run seed
```

Seeded users are created **pre-verified** (`super@user.com` / `superuserdo`
is the platform operator, plus `alice` / `bob` / `dave` demo accounts — alice
admins the `acme` org, dave admins the `beta` org, bob has no org membership)
and can sign in immediately. Re-run any time — the seed is idempotent.

## Verify it works

1. Open `https://identity.somewhatintelligent.localhost` — should redirect to `/sign-in`.
2. Sign in as `super@user.com` / `superuserdo`.
3. Land on `/account` with the user widget showing in the top-right.
4. Confirm the session cookie wears your brand prefix:
   ```sh
   curl -k --cookie-jar /tmp/c -d 'email=super@user.com&password=superuserdo' \
     http://localhost:8787/api/auth/sign-in/email
   grep '\.session_token' /tmp/c    # name reflects packages/config/src/brand.ts
   ```

## Branch isolation

Each git worktree has its own `.wrangler/state/` per-package (gitignored) and
its own `.dev.vars` files (gitignored), so D1 databases and dev secrets are
naturally per-branch. After `git worktree add`, run
`bun install && bun run bootstrap` inside the new worktree, then `bun run dev`
(migrates lazily) and `bun run seed`, and you're set.

## Useful commands

| Command                           | What it does                                            |
| --------------------------------- | ------------------------------------------------------- |
| `bun run bootstrap`               | Write `.dev.vars` per service (env:init) — nothing else |
| `bun run migrate`                 | Apply local D1 migrations                               |
| `bun run seed`                    | Seed demo users/orgs/brands (stack must be up)          |
| `bun run dev [worker…]`           | Cached prep + boot the stack (or a subset)              |
| `bun run check`                   | Workspace-wide lint + format + typecheck                |
| `bun run test`                    | Workspace-wide vitest                                   |
| `bun run build`                   | Workspace-wide build                                    |
| `cd <pkg> && bun run types`       | Regenerate worker-configuration.d.ts for one service    |
| `cd <pkg> && bun run db:generate` | Create a new D1 migration SQL from drizzle schema diff  |

## Troubleshooting

**No demo users to sign in as**: `bun run seed` seeds them, and needs the
stack running first (`bun run dev`). The seed is idempotent, so re-run it any
time.

**`worker-configuration.d.ts` types out of date**: re-run `bun run types`
inside the affected service. This happens whenever `packages/config/src/deploy.ts`
or a `wrangler.jsonc` changes (the typed Env shape is derived from the config's
vars / bindings).

**`vp check` reports vitest-globals errors from `__tests__/`**: known vp
per-file resolver quirk. The workspace-wide check is the reference signal;
treat the test-globals output as noise.

**Sign-in fails for a brand-new sign-up**: seeded users are pre-verified, but a
fresh sign-up you create yourself is gated on email verification, which needs a
`RESEND_API_KEY` in `workers/promoter/.dev.vars`. Without a key, mark that one
user verified via D1:

```sh
cd workers/guestlist && vp exec wrangler d1 execute DB --local \
  --command "UPDATE user SET email_verified = 1 WHERE email = '<email>'"
```

**Portless 404 with `x-portless: 1`**: portless proxy is up but no service
is registered for that hostname. Start the missing worker via `bun run dev <worker>`.
