# Adding a New App

How to add a greenfield app to this platform. Covers both the **TanStack Start**
path (the 90% case) and the **non-Start** adapter pattern (Hono, plain
Workers, Astro, etc.).

The canonical reference is [`workers/identity/`](../workers/identity); copy its
layout. The target shape is documented in `docs/ARCHITECTURE.md` §3.3 and §5.

## 1. The platform contract — what every app must do

Regardless of framework, every app participates in the platform by:

1. Opening a `withRequestContext` scope at its fetch boundary, seeded with
   `extractPlatformRequestId(request)`.
2. Verifying the bouncer attestation envelope via
   `createBouncerEnvelopeVerifier(...)` from `@si/auth`.
3. Reading sessions via the verifier's actor (fast path) or falling back to
   `guestlist.getSession()` over the service binding (slow path).
4. Having no public Custom Domain — only bouncer has one; apps are reached
   via service binding from bouncer.

For TSS apps, the kit's two factory helpers handle (1) and (2) for you.
For non-Start apps, you wire the primitives directly.

## 2. TanStack Start path (default)

Easiest path: `cp -r workers/identity workers/<myapp>` and edit.

### 2.1 File edits inside the new app

```
workers/<myapp>/src/
├── worker.ts                       # ~10 code + 21-line HMR rationale comment — see below
├── lib/
│   ├── platform.ts                 # ~10 code + 16-line comment block — see below
│   ├── session.functions.ts        # 5 lines — TSS compiler constraint
│   ├── auth-context.ts             # ~10 lines — wraps createReactStartAuthProvider
│   ├── guestlist.ts                # ~10 lines — wraps createGuestlistFactory
│   └── (your app-specific helpers)
├── routes/
│   ├── api/$.ts                    # ~30 lines — apiProxyHandlers + request-context seeding
│   ├── __root.tsx                  # standard TSS root
│   └── ...
├── app-brand.ts                    # APP_PRODUCT_NAME (per-app)
└── wrangler.jsonc         # name, bindings
```

**`src/worker.ts`** — hand-written. The kit deliberately does **not** ship a factory wrapper for the worker entry: wrapping it inside a workspace package breaks `@cloudflare/vite-plugin` HMR (the static import of `@tanstack/react-start/server-entry` from a kit module can't be roundtripped, so `createStartHandler` resolves to `undefined` after any route-file edit). Copy identity's `worker.ts` verbatim — including the comment block, which is load-bearing:

```ts
import startEntry from "@tanstack/react-start/server-entry";
import { extractPlatformStartContext } from "@si/kit/react-start";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { requestId: string; callerApp?: string } };
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    return startEntry.fetch(request, { context: extractPlatformStartContext(request) });
  },
} satisfies ExportedHandler<Env>;
```

**`src/lib/platform.ts`** — wires the platform surface. Identity's file is the canonical shape; copy it and change the name + the per-app URL env var. `createServerOnlyFn` wraps every `env`-touching closure to keep wrangler bindings out of the client bundle (TSS bundle-leakage constraint):

```ts
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { createPlatformStartApp } from "@si/kit/react-start";
import { getGuestlist, guestlistFetcher } from "@/lib/guestlist";

export const platform = createPlatformStartApp({
  name: "<myapp>",
  getGuestlist,
  guestlistFetcher: guestlistFetcher as () => typeof fetch,
  getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT),
  expectedHost: createServerOnlyFn(() => new URL(env.<MYAPP>_URL).hostname.toLowerCase()),
});

export const {
  getSession,
  getEnvelope,
  getActiveOrgId,
  envelopeMiddleware,
  apiProxyHandlers,
} = platform;
```

`platform` exposes `getSession`, `getEnvelope`, `getActiveOrgId`, `getGuestlist`, `envelopeMiddleware`, `apiProxyHandlers`, and `devEnvelopeStamper` (only fires if you pass `devEnvelopeSigner` + `devEnvelopeGuestlist` — see ARCHITECTURE.md §4.5). It also still exposes `makeAuthProvider` as a legacy export; new apps should use `envelopeMiddleware` and `createReactStartAuthProvider` instead. (`sessionMiddleware` has been removed from `@si/kit` entirely — it had zero real consumers.)

**`src/lib/session.functions.ts`** — the TSS-compiler-required server-fn
wrapper. Stays minimal:

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { platform } from "@/lib/platform";

export const loadSession = createServerFn({ method: "GET" }).handler(() =>
  platform.getSession(getRequestHeaders()),
);
```

The TSS compile plugin requires `createServerFn(...).handler(...)` to live at
app top-level; this is the only piece that can't be hoisted into the kit.

**`src/routes/api/$.ts`** — guestlist reverse-proxy + Better Auth + admin:

```ts
import { createFileRoute } from "@tanstack/react-router";
import { platform } from "@/lib/platform";

export const Route = createFileRoute("/api/$")({
  server: { handlers: platform.apiProxyHandlers },
});
```

**`src/app-brand.ts`** — per-app product name:

```ts
export const APP_PRODUCT_NAME = "MyApp";
```

### 2.2 Wrangler config

Mirror `workers/identity/wrangler.jsonc` (a checked-in source file: the top level
is staging, `env.production` is the production deploy). The app must have:

- `"workers_dev": false` and `"preview_urls": false` at the top level.
- **No `routes` block** in any environment — only bouncer has Custom Domains.
- A service binding to `GUESTLIST` in both the top level (staging) and
  `env.production`.
- Service bindings to `ROADIE` / `PROMOTER` only if your app uses them.
- A D1 binding only if your app needs its own database.

Named envs do not inherit bindings, so `env.production` must re-declare
everything, with `-production` service names (the top level uses `-staging`).

If your app needs a new D1, create the databases (`wrangler d1 create …`) and
paste each `database_id` directly into the `d1_databases` blocks of your
`wrangler.jsonc` (top level = staging, `env.production` = prod). Local dev keys
on `database_name`, so any placeholder id works there.

### 2.3 Bouncer wiring (this is what makes your app public)

In `workers/bouncer/wrangler.jsonc`, add three things per env:

1. **`services`** — service binding to your app worker:

   ```jsonc
   { "binding": "<MYAPP>", "service": "<myapp>-staging" }
   ```

   (and `<myapp>-production` in `env.production`).

2. **`vars.ROUTES.routes`** — dispatch rule mapping the host:

   ```jsonc
   { "binding": "<MYAPP>", "host": "<myapp>.somewhatintelligent.ca", "path": "/" }
   ```

3. **`env.production.routes`** — Custom Domain entry:
   ```jsonc
   { "pattern": "<myapp>.somewhatintelligent.ca", "custom_domain": true }
   ```
   (and the staging equivalent if you want a staging public URL).

DNS is auto-provisioned by Cloudflare when the Custom Domain entry deploys.

### 2.4 portless (local dev)

Add a `"portless"` key to your app's own `workers/<myapp>/package.json` (there
is no root `portless.json` — each app registers itself):

```jsonc
"portless": { "name": "<myapp>.somewhatintelligent", "script": "dev:bare" }
```

That serves the app at `https://<myapp>.somewhatintelligent.localhost`. Then add
`<myapp>` to the default worker list in `scripts/dev-stack.ts` (or boot it
explicitly with `bun run dev <myapp>`).

### 2.5 Type regen

After editing any cross-wired wrangler config:

```sh
cd workers/<myapp>
bun run types
```

### 2.6 D1 schema (if your app has its own database)

Define tables in `src/db/schema.ts` using `drizzle-orm`. Reference
`workers/identity/src/db/schema.ts` for conventions (text IDs, integer-millis
timestamps, no auth tables — guestlist owns those).

```sh
bun run db:generate         # drizzle-kit generate → migrations/
git add migrations/
vp run db:migrate:local     # apply locally (vp task, defined in vite.config.ts)
vp run db:migrate:staging
vp run db:migrate:production
```

(`db:migrate:*` are per-worker **vp tasks** declared in the worker's
`vite.config.ts`, not `package.json` scripts — run them with `vp run` from
inside the worker directory.)

### 2.7 Deploy

Deploy the app first (so the upstream worker exists), then redeploy bouncer
to wire the binding + provision the Custom Domain:

```sh
cd workers/<myapp> && bun run deploy:production
cd workers/bouncer && bun run deploy:production
```

## 3. Non-Start path (Hono, plain Workers, Astro on Workers, etc.)

The framework-agnostic primitives in `@si/auth`, `@si/guestlist-service/client`,
`@si/kit/request-context`, and `@si/kit/log` work with any
CF-deployable framework. The canonical entry looks like:

```ts
import { createBouncerEnvelopeVerifier, PLATFORM_HEADERS } from "@si/auth";
import { createGuestlistClient } from "@si/guestlist-service/client";
import { withRequestContext, extractPlatformRequestId } from "@si/kit/request-context";
import { withRequestLog } from "@si/kit/log";
import { BOUNCER_ATTESTATION_KEYS } from "@si/config";

const verifyEnvelope = createBouncerEnvelopeVerifier({
  keys: BOUNCER_ATTESTATION_KEYS,
  env: env.ENVIRONMENT,
  expectedHost: (req) => new URL(req.url).hostname.toLowerCase(),
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const rid = extractPlatformRequestId(request);
    return withRequestContext({ requestId: rid }, () =>
      withRequestLog({ service: "<myapp>" }, request, async (log) => {
        const result = await verifyEnvelope(request);
        // result.kind === "valid"   → result.actor is { id, role, ... } | null
        // result.kind === "missing" → handled by verifier per ENVIRONMENT
        // result.kind === "invalid" → handled by verifier per ENVIRONMENT

        // Your framework's routing here (Hono, plain handlers, etc.).
        return new Response("ok");
      }),
    );
  },
} satisfies ExportedHandler<Env>;
```

Everything else (wrangler config, service binding to guestlist, bouncer
wiring, portless) is identical to §2.2–§2.7. The non-Start app just doesn't
use the `createPlatformStartApp` factory or the `apiProxyHandlers` — it
defines its own routes via its framework of choice.

## 4. Brand wiring

Every app reads platform-wide brand from `@si/config`:

```ts
import { platformConfig } from "@si/config";
// platformConfig.brand.name      → "Platform" by default
// platformConfig.cookies.prefix  → "platform"
// platformConfig.auth.providerId → "platform"
```

Per-app product name lives in `workers/<myapp>/src/app-brand.ts` as
`APP_PRODUCT_NAME`. Both files are edited once per fork; no other code-level
rebranding is required.

## 5. Checklist

- [ ] App scaffolded under `workers/<myapp>/` mirroring `workers/identity/`
- [ ] (TSS) `src/lib/platform.ts`, `src/lib/session.functions.ts`, `src/worker.ts`, `src/routes/api/$.ts` written per §2.1
- [ ] (non-Start) entry wraps `withRequestContext` + `withRequestLog` + `verifyEnvelope` per §3
- [ ] `wrangler.jsonc` top-level: `workers_dev: false`, `preview_urls: false`, no `routes` block in any env
- [ ] Service bindings declared: `GUESTLIST` (always), `ROADIE` / `PROMOTER` (if used)
- [ ] `workers/bouncer/wrangler.jsonc` updated per §2.3
- [ ] `"portless"` key added to the app's `package.json` per §2.4
- [ ] `bun run types` succeeds with the cross-wired `-c` chain
- [ ] D1 provisioned + migrations applied (if app has a database)
- [ ] `app-brand.ts` set; no brand literals scattered elsewhere
- [ ] Deploy in order: app first, then bouncer

---

For deeper detail on the platform's auth model, envelope, header contract,
and dev/prod parity, see `docs/ARCHITECTURE.md`.
