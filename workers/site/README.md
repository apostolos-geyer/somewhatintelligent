# somewhatintelligent site

Astro 7 SSR implementation of the somewhatintelligent publishing-house public
site, deployed as a Cloudflare Worker via `@astrojs/cloudflare` (RFC-0001 D4).

```sh
cd workers/site
bun run env:init   # first boot: seed .dev.vars
bun run dev
```

The local server listens on `http://127.0.0.1:4321`. Pages are currently
hardcoded; data-driven loaders land with the read-model track (T20).

Site is presentation-only (INV-SITE-1): its only bindings are the read-only
`PUBLISHER` (`PublisherPublic`) and `STORE` (`StoreCatalog`) service
entrypoints, and it carries no `routes` block — bouncer binds it at the root
mount. Deploys go through the adapter's build output:

```sh
bun run typecheck
bun run build
bun run deploy:staging      # astro build && wrangler deploy
bun run deploy:production   # astro build && wrangler deploy --env production
```

After editing `wrangler.jsonc`, regenerate the typed Env shape with
`bun run types`.
