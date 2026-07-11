# TODO before merge

## Dependency wiring — RESOLVED

- `@somewhatintelligent/*` pins are on stable releases (kit 0.0.3, bouncer 0.0.3,
  og 0.0.2, auth 0.0.3, guestlist 0.0.5, stripe 0.0.1); the `file:` links and
  the root `@somewhatintelligent/auth` override are gone.

## Other follow-ups from the identity template adoption

- ~~Re-wire identity analytics~~ DONE: `workers/identity/src/analytics.adapter.tsx`
  bridges the kit analytics seam (`createAnalytics`) onto `@si/analytics/client`
  — PostHog events flow again, call sites untouched.
- `packages/og` (`@si/og`) is now unused — nothing imports it once identity
  switched to `@somewhatintelligent/og`. Consider deleting it once nothing
  else picks it up, or repurpose it.
- `packages/design/src/tokens/brand.ts`'s `functionalColors.warning.light`
  was retuned lighter than the old "DRAFT" design's mid-ink value, because
  the new design template's semantic contract always pairs
  `warningForeground` with dark text in both themes (unlike the old design,
  which relied on `text-primary-foreground`'s per-theme flip). If the
  visual weight of `warning` reads too pale, that's the tradeoff to
  revisit — see the comment on that token and `bun run audit:contrast`.
- `packages/config/src/brand.ts`'s `brand.short` and `brand.supportEmail`
  fields have no reader left in the codebase now that identity uses its own
  `app.config.ts` copies of these values. Not wrong, just vestigial — worth
  pruning or re-wiring in a follow-up.
