# operator

The single **Access-protected operator console** (RFC-0001 D1). Apostoli
authors and operates texts, software records, pages, products, stock, media,
orders, and fulfillment here. It deploys **directly on `desk.*`, outside
Bouncer**, behind a self-hosted Cloudflare Access application; it never shares
the customer IdP hostname.

- **Auth is Cloudflare Access, not the platform session** (D6). A fail-closed
  middleware validates the Access application JWT and yields an `OperatorActor`;
  passing Access does not create a Guestlist user or platform session
  (INV-ACCESS-2).
- **No domain-data capability** (INV-OP-2). Operator binds no D1, R2, Stripe, or
  Guestlist. Its server functions reach domain state only through the
  `StoreOperator` / `PublisherOperator` service bindings, and each wraps exactly
  one owning RPC (D7).
- `workers_dev` and `preview_urls` are **off** in every deployed environment, so
  no alternate unprotected hostname can bypass Access.
- **Deploys manually, like `inbox`** — Operator owns its own `desk.*` hostname
  and is **not** a release-please component and has **no CI deploy lane**. Ship
  it with `bun run deploy:staging` / `bun run deploy:production`; it is versioned
  informally.

## Status — SHELL

The **TanStack Start shell** is in place (track **T22** infrastructure). The
worker runs the Access gate first (`src/worker.ts` → `resolveOperator`,
403/500 fail-closed), then hands off to TanStack Start with the verified
`OperatorActor` seeded into the request context. Server functions read that
actor back via `requireOperatorActor` (`src/lib/server-fn-actor.ts`) rather
than re-verifying the JWT, and derive `OperatorMeta` server-side
(`buildOperatorMeta`, RFC-0001 D7). The root shell (`src/routes/__root.tsx`)
lists the eight planned modules (D1); only **Overview** (`/`) is built — it
renders `Signed in as {actor.email}`, proving Access → shell → page end to end.
The other modules are nav links that resolve to a "coming soon" not-found stub.

Operator is **root-mounted on its own desk.\* hostname** (not vmf-mounted behind
bouncer), so the router carries no `mountRewrite`/`basepath`/`PUBLIC_BASE`
machinery and server functions use the default (root) base.

Still to come:

- the eight domain modules (Objects/Texts/Software/Pages/Orders/Media/Settings)
  and the storage-neutral media-upload routes;
- the `STORE` / `PUBLISHER` `*Operator` service bindings and the server
  functions that wrap exactly one owning RPC each (next track — no service
  bindings are declared in `wrangler.jsonc` yet, INV-OP-2);
- the idempotent two-environment Access setup script that writes `POLICY_AUD` /
  `TEAM_DOMAIN` (T4; donor: `inbox/scripts/setup-access.mjs`).

## Local dev

```sh
bun run dev            # vite (vp dev) on OPERATOR_PORT (default 8792)
```

In development the Access gate resolves the fixed `DEV_OPERATOR` from
`.dev.vars` (no Cloudflare Access needed). Open the root URL and you land on the
Overview page reading `Signed in as operator@somewhatintelligent.localhost`,
with the eight-module nav rail down the left. `bun run typecheck` (tsgo, `src/`)
and `bun run test` (vitest) gate changes.

After editing `wrangler.jsonc`, run `bun run types` to refresh
`worker-configuration.d.ts`.
