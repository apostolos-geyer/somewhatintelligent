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

## Status — SCAFFOLD

This is track **T2** of
[`docs/exec-plans/active/0004-unified-publishing-commerce-control-plane.md`](../../docs/exec-plans/active/0004-unified-publishing-commerce-control-plane.md),
plus the fail-closed shape of **T3**. The worker deploys behind Access, resolves
an `OperatorActor` (development uses the fixed `DEV_OPERATOR`), and fails closed
everywhere else. Still to come:

- real `Cf-Access-Jwt-Assertion` verification against the team JWKS / issuer /
  audience via `jose` (T3);
- the idempotent two-environment Access setup script that writes `POLICY_AUD` /
  `TEAM_DOMAIN` (T4; donor: `inbox/scripts/setup-access.mjs`);
- the TanStack Start console — the eight modules, the server-fn factory
  (`OperatorMeta` server-side + one owning RPC), and the storage-neutral
  media-upload routes — plus the `STORE`/`PUBLISHER` service bindings (T22).

After editing `wrangler.jsonc`, run `bun run types` to refresh
`worker-configuration.d.ts`.
