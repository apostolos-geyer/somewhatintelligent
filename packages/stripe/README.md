# @si/stripe

Idempotent Stripe IaC for the platform's subscription billing: `src/config.ts`
declares products/prices as plain TS objects, and three scripts keep a real
Stripe account in sync with that config. Ported from HiPat.app's
`packages/stripe`, trimmed to a single subscription tier for this fork.

## Layout

- `src/config.ts` — source of truth. `products.member` (single tier) and
  `prices.member_monthly` ($10.00 CAD/month placeholder — see below).
- `src/types.ts` — shared types + the metadata keys used for idempotent
  matching (`managed_by` = `"si"`, `config_key` = the config object key).
- `src/generated.ts` — **gitignored build output**. Real Stripe ids (or the
  offline stub). Never hand-edit; regenerate with `bun run fetch`.
- `src/index.ts` — re-exports `generated` + `config` + `types`.
- `scripts/fetch.ts` — read-only. Looks up existing managed resources and
  writes `src/generated.ts`. Without `STRIPE_SECRET_KEY` it writes a typed
  stub (empty-string ids) and exits 0 — this is the offline/agent-mode path.
- `scripts/sync.ts` — creates/updates Stripe products and prices from
  `config.ts`, then regenerates `src/generated.ts`. Requires
  `STRIPE_SECRET_KEY`.
- `scripts/validate.ts` — read-only drift check (config vs. live Stripe
  account). Requires `STRIPE_SECRET_KEY`.

## Idempotency

Every managed resource carries two metadata fields:

- `managed_by = "si"` — marks it as owned by this IaC (so `list()` calls can
  filter to just "ours" without touching unrelated resources on the account).
- `config_key` — the **object key** from `products`/`prices` (e.g.
  `"member_monthly"`), never the display name. This is the stable identity
  `fetch`/`sync`/`validate` match on, so renaming `products.member.name` (or
  any other cosmetic field) updates the existing Stripe resource instead of
  creating an orphaned duplicate.

Prices are immutable in Stripe once created — changing `amount` or
`interval` for an existing `config_key` does not update the live price;
`sync`/`validate` report it as **drift**. Bump the price by adding a new
config key (e.g. `member_monthly_v2`) and switching consumers to it.

## Offline / agent mode

Without `STRIPE_SECRET_KEY` set, `bun run fetch` never imports the `stripe`
SDK or touches the network — it writes `src/generated.ts` as a stub with
every configured product/price id set to `""`. This is wired into
`typecheck` (`"typecheck": "bun run fetch && tsgo --noEmit"`), so:

- A fresh clone (no secrets anywhere) typechecks cleanly — `stripeProducts` /
  `stripePrices` exist with the right key set and type shape, just empty ids.
- Any code that actually _calls_ Stripe with a stub id fails loudly at
  runtime (empty string is not a valid Stripe id) instead of silently doing
  the wrong thing.

## Onboarding a real key later

1. Get a Stripe secret key (test mode first) and set `STRIPE_SECRET_KEY` in
   your shell (never commit it — see `docs/ops/env-vars.md`).
2. `cd packages/stripe && bun run sync` — creates the `member` product and
   `member_monthly` price if they don't exist yet, and regenerates
   `src/generated.ts` with the real ids.
3. `bun run validate` any time after to check for drift without mutating
   anything.
4. To flip the better-auth Stripe plugin on for a worker, set
   `STRIPE_SECRET_KEY` **and** `STRIPE_WEBHOOK_SIGNING_SECRET` for that
   worker (see `docs/ops/env-vars.md` — guestlist section). The plugin is
   fully gated on both being present; nothing else needs to change.
5. Update `prices.member_monthly.amount` in `src/config.ts` to the real
   price **before** the first `sync` against a live account — remember
   prices are immutable once created (see above).
