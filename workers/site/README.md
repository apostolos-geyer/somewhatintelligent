# somewhatintelligent site

Static Astro 7 implementation of the somewhatintelligent publishing-house home page.

```sh
cd workers/site
bun run dev
```

The local server listens on `http://127.0.0.1:4321`. The site has no runtime bindings, API
routes, hydrated islands, or external network dependencies. Its production build is fully static.

```sh
bun run typecheck
bun run build
```
