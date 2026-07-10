# TODO before merge

## Dependency wiring: flip file: links back to published versions

`workers/identity/package.json` currently points two `@somewhatintelligent/*`
deps at the platform checkout on disk instead of the npm registry, because
neither is published yet:

```jsonc
"@somewhatintelligent/kit": "file:/home/user/platform/packages/kit",   // dependencies
"@somewhatintelligent/og": "file:/home/user/platform/packages/og",     // devDependencies
```

Once platform's RFC-0003 branch (templates: design/ui/identity + the `og`
package) merges and beta-publishes, flip both back to real `^`-ranged
versions matching what every other worker already uses for
`@somewhatintelligent/*` (see `workers/guestlist/package.json`,
`workers/store/package.json`, etc. — currently exact pins like `0.0.3`/
`0.0.5`, not caret ranges; match that convention rather than the scaffolder's
default `^`).

Also revisit the root `package.json` `overrides` entry:

```jsonc
"@somewhatintelligent/auth": "0.0.3"
```

This was added ONLY because `@somewhatintelligent/kit`'s own manifest depends
on `@somewhatintelligent/auth` via `workspace:^`, which cannot resolve once
`kit` is pulled in via `file:` from outside platform's own workspace. Once
`kit` is a real published dependency, its `auth` dependency will resolve
normally through the registry and this override can likely be deleted —
confirm with a clean `bun install` after the flip.

Two root `catalog` entries (`typescript`, `@cloudflare/workers-types`,
`wrangler`) were added purely to satisfy `catalog:` refs inside
`kit`/`og`'s own `package.json` (their `devDependencies`, which nothing in
si actually needs built) — harmless to keep, but worth a look at the same
time in case they become genuinely unnecessary.

## Other follow-ups from the identity template adoption

- `workers/identity/src/lib/analytics.ts` is now the template's swappable
  no-op stub. Re-wire it to `@si/analytics/client` (the real PostHog
  integration used by every other app) if identity should keep shipping
  analytics — the old identity had this wired; the new one dropped it.
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
