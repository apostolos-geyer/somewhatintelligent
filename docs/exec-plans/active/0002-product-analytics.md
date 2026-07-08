# Product Analytics (PostHog) — Engineering Spec

Single free-tier PostHog project; two TanStack Start workers (`identity` @ `/account`, `store` @ `/shop`) sharing the `somewhatintelligent.ca` apex via bouncer vmf mounts. Guiding value: **lean, deliberate instrumentation** — every event and every profile costs quota, so the registry is the whole surface and autocapture/replay are off.

> Grounding note: `@si/kit/request-context` (`packages/kit/src/request-context/index.ts`) holds a `RequestContext` ALS (requestId/actor/callerApp) — it does **not** capture the Cloudflare `ExecutionContext`, and store/identity `worker.ts` never open it at the boundary. The real `AsyncLocalStorage<ExecutionContext>` lives only in `workers/guestlist/src/plugins/execution-context.ts`. The delivery helper therefore belongs in a **new** `@si/kit/execution-context` sibling module, not folded into request-context.

## 1. Current-state assessment

Ranked; the top two are the things that are _actually broken_ (nothing is reliably delivered, and one human fragments into several persons). Everything below CRITICAL compounds those two.

| #   | Sev      | Issue                                                                                                                                                                                                                                                                     | File                                                                              | Fix direction                                                                                             |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | CRITICAL | `order_placed` is fire-and-forget — unawaited `capture()`, no `waitUntil`/`captureImmediate`; the isolate can freeze after the response and drop the ingest POST. The key conversion event is lost under normal/cold conditions.                                          | `workers/store/src/lib/orders.functions.ts:125`                                   | `ctx.waitUntil(client.captureImmediate(...))` via a seeded ExecutionContext ALS.                          |
| 2   | CRITICAL | Store never calls `identify`/`reset`/`group`; server `order_placed` keys on `session.user.id` while the store client browses under an anonymous id → the funnel top and the conversion land on **two persons**, and identity↔store never unify for a store-first visitor. | `workers/store/src/routes/__root.tsx` (no identifier) + `orders.functions.ts:126` | One shared session-keyed identify bridge, mounted in **both** roots; `distinctId = user.id` everywhere.   |
| 3   | CRITICAL | Token read via `import.meta.env.VITE_PUBLIC_POSTHOG_*` reaches **neither** the client bundle nor the SSR worker in **any** env (not in `CLIENT_VARS`, no `.env`, `.dev.vars` ≠ `import.meta.env`); `!` masks `undefined` → posthog inits with no key and silently no-ops. | `__root.tsx` (both) + `workers/store/src/lib/posthog-server.ts:7`                 | Source token/host from an `@si/config` constant read by client (build-inlined) and server (runtime).      |
| 4   | HIGH     | No `app` discriminator on any event → within the one shared project, identity vs store traffic is indistinguishable (autocapture/pageviews included).                                                                                                                     | `__root.tsx` (both)                                                               | `before_send` stamps `{app, environment}` on every client event; server helper stamps it too.             |
| 5   | HIGH     | No `ExecutionContext`/`waitUntil` reachable in either worker — entries drop `ctx` — so finding #1 has **no rescue path** at all.                                                                                                                                          | `workers/store/src/worker.ts`, `workers/identity/src/worker.ts`                   | Promote guestlist's ExecutionContext ALS into `@si/kit/execution-context`; seed it at both entries.       |
| 6   | HIGH     | Deployed builds have **no token source** — nothing in `wrangler.jsonc` (staging or prod), no `env-vars.md` row.                                                                                                                                                           | `workers/*/wrangler.jsonc`, `docs/ops/env-vars.md`                                | `@si/config` constant + one `env-vars.md` note-row; optional `env.POSTHOG_KEY` override.                  |
| 7   | HIGH     | `posthog-js` is an undeclared direct dep — only a hoisted peer of `@posthog/react` (bun hoisted `1.398.1`). Brittle under isolated installs/stricter linker.                                                                                                              | `workers/{store,identity}/package.json`                                           | Declare all three posthog deps once in `@si/analytics`.                                                   |
| 8   | MED      | `signed_in {method:"email"}` vs a separate `signed_in_with_passkey` event → by-method breakdown is split; verb-order taxonomy is mixed (`add_to_cart` vs `product_viewed`).                                                                                               | `workers/identity/src/components/auth/sign-in-form.tsx:130,168`                   | Merge to `signed_in {method:"passkey"}`; normalize to `object_verbed` past tense.                         |
| 9   | MED      | `cart_quantity_changed` fires on every +/- click (5 taps = 5 events); redundant with clicks, pure free-tier burn.                                                                                                                                                         | `workers/store/src/routes/_public/cart.tsx:53,70`                                 | Drop it.                                                                                                  |
| 10  | MED      | `posthog-server.ts` is byte-identical across both workers; identity's copy is **dead** (never imported).                                                                                                                                                                  | `workers/{store,identity}/src/lib/posthog-server.ts`                              | Delete both; replace with `@si/analytics/server`.                                                         |
| 11  | LOW      | Cookie scope / `person_profiles` / session-replay all implicit behind the dated `defaults` preset → www↔apex `distinct_id` split, every anon visitor mints a billed profile, replay silently consumes the cap.                                                            | `__root.tsx` (both)                                                               | Explicit `cross_subdomain_cookie`, `person_profiles:"identified_only"`, `disable_session_recording:true`. |
| 12  | LOW      | `reset()` only on the sign-out and delete-account buttons → misses session expiry, revocation, and store logout (shared-computer leak).                                                                                                                                   | `sidebar-user-menu.tsx:32`, `delete-account-dialog.tsx:34`                        | Transition-guarded `reset()` inside the shared bridge.                                                    |

## 2. Target architecture (one diagram-in-prose)

One new workspace package, **`@si/analytics`** (`packages/analytics`), is the single home for all three vendor deps and mirrors `@si/kit`'s client/server subpath split so `posthog-node` never enters a browser bundle and `posthog-js` never enters an isolate:

```
@si/analytics
├── /events   (isomorphic, ZERO runtime deps)  ── the typed EventRegistry: AppName,
│                                                  ClientEventProps, ServerEventProps,
│                                                  person-property + group-key types.
│                                                  Client capture, server capture, and
│                                                  tests all type against this ONE file.
├── /client   (@posthog/react, posthog-js)     ── <AnalyticsProvider app session> which
│                                                  composes the identity bridge internally,
│                                                  plus a typed useCapture() hook.
└── /server   (posthog-node, @si/kit/execution-context, @si/config)
                                                ── serverAnalytics(app).capture(...): the
                                                   ONLY server entry point; owns waitUntil delivery.

@si/kit/execution-context   ── NEW sibling module: AsyncLocalStorage<ExecutionContext>
                               + runWithExecutionContext(ctx, fn). guestlist re-points to it.

@si/config → platformAnalyticsConfig { token, host }   ── the public phc_ key as a compiled
                                                          constant (4th centralized-config file).
```

- **Client init lives** in each app's `__root.tsx`, which renders exactly one `<AnalyticsProvider app="identity|store" session={session}>`. The provider mounts `PostHogProvider` with the hardened option block (§4) and the identity bridge — so store _cannot_ silently ship without an identifier again.
- **Server delivery lives** in `@si/analytics/server`, called from exactly one site today (`orders.functions.ts`). It reads `ctx` from the `@si/kit/execution-context` ALS seeded at the worker entry.
- **The single project is shared** by construction: both apps read the same `platformAnalyticsConfig.token`, so `posthog-js` persistence keys line up on the shared apex origin; `distinctId = user.id` (§4) unifies client↔server and identity↔store; `{app, environment}` on every event (§4/§5) is what segments the one project back apart.

Workers depend only on `@si/analytics` (+ existing `@si/config`, `@si/kit`); the raw `@posthog/*`/`posthog-node` deps leave both worker `package.json`s.

## 3. Reliable server-side delivery (Workers)

**Mechanism:** `ctx.waitUntil(client.captureImmediate(payload))`. `captureImmediate` (posthog-node 5.39.4) issues the ingest HTTP send and returns its promise, bypassing the in-memory queue entirely — nothing is buffered on the shared global to lose on freeze. `waitUntil` keeps the isolate alive until that POST resolves **after** the response flushes, adding **zero** latency to the order response. When no `ctx` is in scope (tests, non-request paths), the helper falls back to `await`ing the send — correct-but-slower, never dropped.

**How `ctx` is obtained in a TanStack Start server fn:** it isn't, natively — Start server fns read `env` via `cloudflare:workers` but have no first-class `ctx`. Both hand-written entries currently drop it (`store` takes `(request)`, `identity` takes `(request, env)`). Fix: a new `@si/kit/execution-context` module (the ExecutionContext ALS promoted out of `workers/guestlist/src/plugins/execution-context.ts`; guestlist re-points there), seeded around the existing entry body:

```ts
// packages/kit/src/execution-context/index.ts   →  @si/kit/execution-context
import { AsyncLocalStorage } from "node:async_hooks";
export const executionContext = new AsyncLocalStorage<ExecutionContext>();
export const runWithExecutionContext = <T>(ctx: ExecutionContext, fn: () => Promise<T>) =>
  executionContext.run(ctx, fn);
```

```ts
// workers/{store,identity}/src/worker.ts — capture ctx, wrap the WHOLE existing body
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return runWithExecutionContext(ctx, async () => {
      /* unchanged: devEnvelopeStamper → startEntry.fetch(...) → set-cookie merge → return */
    });
  },
} satisfies ExportedHandler<Env>;
```

**Per-request vs global client:** keep the module-global singleton — it is a stateless sender (every capture carries its own `distinctId`, no per-user state on the global). Keep `flushInterval: 0` (no background timer — `setInterval` is unsafe across the Workers request lifecycle), no `personalApiKey` (no feature-flag polling timer), and **never** `shutdown()` the shared client mid-request (it tears down timers for later requests in the same reused isolate).

### 3a. The `analyticsEvent` middleware — the only server capture seam

The public `@si/analytics/server` surface deliberately exposes **no function that takes a caller-supplied `distinctId`**. That parameter is the exact hole that lets a new server fn key an event off `email`, `order_number`, or an org id and fragment one human into several PostHog persons. The guarantee has to be **structural, not conventional**: the person-scoped delivery core is sealed _inside_ the package, and the only way to emit a person-scoped server event is the `analyticsEvent` middleware, which forces `distinctId = session.user.id`.

**Server events are opt-in and business-only.** `analyticsEvent` is added _deliberately_, per server fn, and **only** to product/business events — the ones modelled in the `ServerEventProps` registry (§5), which is intentionally tiny (`order_placed` today). The overwhelming majority of server fns — reads, CRUD, admin, session/plumbing — carry **no** analytics middleware and emit nothing. The typed registry _is_ the allowlist: `analyticsEvent<E extends ServerEvent>` won't type-check for an event that isn't a modelled business event, so "instrument every server fn" is not representable.

**Package layout — the `exports` map is the seal.** `@si/analytics`'s `package.json` declares subpaths `./events`, `./client`, `./server` **only**; `posthog-node` is a dependency of `@si/analytics` and of no worker. The internal delivery module is not a subpath, so `@si/analytics/server/delivery` is unresolvable — the `exports` field seals deep imports on both the TypeScript (`moduleResolution: bundler`) and bundler sides.

```
packages/analytics/src/server/
  index.ts       →  @si/analytics/server   (PUBLIC: makeAnalyticsEvent, serverAnalytics().captureAnonymous)
  delivery.ts       INTERNAL — no subpath export; the ONLY code that supplies a distinctId
  analytics-event.ts  INTERNAL — makeAnalyticsEvent; imports delivery.ts (stays sealed in the package)
```

```ts
// packages/analytics/src/server/delivery.ts   —  INTERNAL to @si/analytics (NOT in "exports")
// The only place in the platform that supplies a PostHog distinctId.
import { PostHog } from "posthog-node";
import { env } from "cloudflare:workers";
import { executionContext } from "@si/kit/execution-context";
import { platformAnalyticsConfig } from "@si/config";
import { ulid } from "@si/kit/ids";
import type { AppName, ServerEvent, ServerEventProps } from "../events";

let client: PostHog | null = null;
const analytics = () =>
  (client ??= new PostHog(env.POSTHOG_KEY ?? platformAnalyticsConfig.token, {
    host: platformAnalyticsConfig.host,
    flushAt: 1,
    flushInterval: 0, // no background timer; captureImmediate sends inline
  }));

// waitUntil when a ctx is seeded (zero added latency), else await (never dropped).
async function send(payload: Parameters<PostHog["captureImmediate"]>[0]): Promise<void> {
  const sent = analytics().captureImmediate(payload);
  const ctx = executionContext.getStore();
  if (ctx) {
    ctx.waitUntil(sent);
    return;
  }
  await sent;
}

/** Person-scoped. `distinctId` is REQUIRED and — by construction of its only
 *  caller, `analyticsEvent` — is always `session.user.id`. */
export function deliverIdentified<E extends ServerEvent>(
  app: AppName,
  distinctId: string,
  event: E,
  properties: ServerEventProps[E],
  groups?: { organization: string },
): Promise<void> {
  return send({
    distinctId,
    event,
    properties: { ...properties, app, environment: env.ENVIRONMENT },
    groups,
  });
}

/** Anonymous-scoped. `$process_person_profile:false` + a throwaway id, so it can
 *  never create or mutate a person. */
export function deliverAnonymous<E extends ServerEvent>(
  app: AppName,
  event: E,
  properties: ServerEventProps[E],
): Promise<void> {
  return send({
    distinctId: ulid(),
    event,
    properties: {
      ...properties,
      app,
      environment: env.ENVIRONMENT,
      $process_person_profile: false,
    },
  });
}
```

```ts
// packages/analytics/src/server/analytics-event.ts   —  INTERNAL; re-exported by index.ts
import { createMiddleware } from "@tanstack/react-start";
import type { AnyFunctionMiddleware } from "@tanstack/react-start"; // verified export (1.168.18)
import type { PlatformSession } from "@si/auth";
import type { AppName, ServerEvent, ServerEventProps } from "../events";
import { deliverIdentified } from "./delivery";

export type Derived<E extends ServerEvent> = {
  properties: ServerEventProps[E];
  group?: boolean;
} | null;

/**
 * Bind an app + its session-producing auth middleware ONCE, per worker. Returns
 * the declarative `analyticsEvent(event, derive?)` used inside `.middleware([…])`.
 * Fires ONLY when the handler resolves; `distinctId` is derived from
 * `context.session.user.id` and can never be supplied by a call site.
 */
export function makeAnalyticsEvent(config: { app: AppName; requireAuth: AnyFunctionMiddleware }) {
  return function analyticsEvent<E extends ServerEvent>(
    event: E,
    // Optional: a property-less business event drops on bare — `analyticsEvent("some_event")`.
    derive?: (args: { session: PlatformSession; data: unknown; result: unknown }) => Derived<E>,
  ) {
    return createMiddleware({ type: "function" })
      .middleware([config.requireAuth]) // session guaranteed non-null; anon → 401 before the handler
      .server(async ({ context, data, next }) => {
        const res = await next(); // throws on handler failure/redirect → nothing below runs → nothing emitted
        const session = context.session as PlatformSession; // single cast, sealed in the package
        // next()'s runtime object carries `.result` (the handler return); the public type hides it.
        const derived = derive
          ? derive({ session, data, result: (res as { result: unknown }).result })
          : ({ properties: {} as ServerEventProps[E] } as Derived<E>);
        if (derived) {
          const orgId = session.session.activeOrganizationId;
          await deliverIdentified(
            config.app,
            session.user.id, // the engineer literally cannot provide or mistype this
            event,
            derived.properties,
            derived.group && orgId ? { organization: orgId } : undefined,
          );
        }
        return res; // a middleware MUST return next()'s result
      });
  };
}
```

```ts
// packages/analytics/src/server/index.ts   →  @si/analytics/server   (the ONLY public server surface)
import type { AppName, ServerEvent, ServerEventProps } from "../events";
import { deliverAnonymous } from "./delivery";
export { makeAnalyticsEvent, type Derived } from "./analytics-event";

// Deliberately NO distinctId-taking capture is exported. Person-scoped delivery
// is reachable only through the middleware `makeAnalyticsEvent` returns, which forces
// distinctId = session.user.id. A "server event on the wrong person" is not
// representable at any call site.
export function serverAnalytics(app: AppName) {
  return {
    /** The rare genuinely-anonymous server metric. NOT for user events. */
    captureAnonymous<E extends ServerEvent>(
      event: E,
      properties: ServerEventProps[E],
    ): Promise<void> {
      return deliverAnonymous(app, event, properties);
    },
  };
}
```

```ts
// workers/store/src/lib/middleware/analytics.ts   (identity gets the mirror with app: "identity")
import { makeAnalyticsEvent } from "@si/analytics/server";
import { requireAuthMiddleware } from "./auth";

// APP baked once, per worker — never a caller argument. requireAuth is folded
// in, so ONE `.middleware([analyticsEvent(...)])` entry both auth-gates AND instruments.
export const analyticsEvent = makeAnalyticsEvent({
  app: "store",
  requireAuth: requireAuthMiddleware,
});
```

The per-worker file is three lines and can import **nothing** that takes a `distinctId` — that function does not exist on the public surface. Instrumenting a server fn is one declarative line in `.middleware([…])`; the handler body gains nothing to call, nothing to await, and no id to mistype.

**Why the factory seam (over a `context.track`/`context.capture` helper).** A `context.capture(event, props)` injected into `context` is imperative: the engineer must _remember_ to call it, can call it _before_ a `throw`, and holds a live `capture` reference to misuse. The factory is fully declarative — the event lives in the `.middleware([…])` array, the handler body is untouched — and it emits _only_ on success **structurally**, because `next()` re-throws on the failure path and skips every line after it. The one wart (`next().result` is untyped) is a single `as` sealed inside `analyticsEvent`; no app code ever sees it.

**Composition is baked, not trusted.** `analyticsEvent` chains `requireAuth` internally, so DFS ordering runs `authMiddleware → requireAuthMiddleware → analyticsEvent → serverFn` and `context.session` is guaranteed populated when the analytics leg runs. A single array entry both auth-gates and instruments the fn — the `requireAuth` dependency can never be mis-ordered at a call site.

**The no-session / anonymous case is unreachable by construction.** Because `analyticsEvent` composes `requireAuth`, an unauthenticated request 401s before the handler — a person-scoped server event with a fabricated `distinctId` cannot be emitted through this seam. For a genuinely-anonymous server metric, use `serverAnalytics(app).captureAnonymous(event, props)` (`$process_person_profile:false` + throwaway id) — it can never write into the `user.id` person namespace. Default stance: no person-scoped server event without a session.

**Gotcha to document at the seam:** a handler whose _success_ path does `throw redirect(...)` is treated as an error by `next()` and re-thrown, so `analyticsEvent` emits nothing for it. `order_placed` returns data, so it is fine; any future instrumented fn that redirects on success must be reworked to return.

**The deny rule (the repo has no eslint — `vp check` is the checker).** Two lines of defense make "raw posthog client" as unrepresentable as the distinctId footgun: (1) the package boundary + `exports` seal above; (2) an enforced backstop test (bun hoisting can still surface a hoisted vendor dep at runtime, so the boundary alone is not airtight), run under the existing `vp run -r test`:

```ts
// packages/analytics/src/__tests__/vendor-boundary.test.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

const VENDOR = /from\s+["'](posthog-node|posthog-js|@posthog\/react)["']/;
const repoRoot = (d = import.meta.dirname): string => {
  while (!existsSync(join(d, "bun.lock"))) {
    const up = dirname(d);
    if (up === d) throw new Error("no root");
    d = up;
  }
  return d;
};
const walk = (dir: string, hits: string[]) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, hits);
    else if (/\.tsx?$/.test(e.name) && VENDOR.test(readFileSync(p, "utf8"))) hits.push(p);
  }
};

test("posthog vendor deps are imported only inside @si/analytics", () => {
  const root = repoRoot(),
    hits: string[] = [];
  for (const base of ["workers", "packages"]) walk(join(root, base), hits);
  const leaks = hits.filter((p) => !p.includes(join("packages", "analytics")));
  expect(leaks, `posthog imported outside @si/analytics:\n${leaks.join("\n")}`).toEqual([]);
});
```

#### `order_placed` rewritten

The success return widens to carry the order economics (the confirmation screen renders these without a refetch), so `derive` reads them straight off `result`. The unawaited `getPostHogClient().capture(...)` and the `@/lib/posthog-server` import are deleted.

```ts
export type PlaceOrderResult =
  | {
      ok: true;
      orderNumber: string;
      itemCount: number;
      subtotalCents: number;
      shippingCents: number;
      totalCents: number;
    }
  | { ok: false; error: string; message?: string };

export const placeOrder = createServerFn({ method: "POST" })
  // ONE line instruments the fn AND auth-gates it (analyticsEvent folds in requireAuthMiddleware).
  .middleware([
    analyticsEvent("order_placed", ({ result }) => {
      const r = result as PlaceOrderResult;
      if (!r.ok) return null; // priced-failure is a RETURN, not a throw → emit nothing
      return {
        properties: {
          order_number: r.orderNumber,
          item_count: r.itemCount,
          subtotal_cents: r.subtotalCents,
          shipping_cents: r.shippingCents,
          total_cents: r.totalCents,
        },
        group: true, // attach groups.organization when the session has an active org
      };
    }),
  ])
  .inputValidator((data: typeof placeOrderInput.infer) => placeOrderInput.assert(data))
  .handler(async ({ data, context }): Promise<PlaceOrderResult> => {
    // …unchanged pricing/validation/insert-statement construction…
    await db.batch([orderInsert, ...lineStatements]); // failure throws → analyticsEvent emits nothing
    return {
      ok: true,
      orderNumber: num,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      subtotalCents: subtotal,
      shippingCents,
      totalCents: total,
    };
  });
```

`context.session.user.{id,email}` stays available to the handler exactly as today (the folded-in `requireAuthMiddleware` still populates it). The engineer never sees `distinctId`, `groups`, `app`, `environment`, `captureImmediate`, or `waitUntil` — and cannot import anything that would let them.

> Interim option if wrapping both entries is deferred: `deliverIdentified`'s `await` fallback already guarantees delivery when no `ctx` is seeded (it just pays the ~50–200 ms round-trip). Seed the ALS to reclaim that latency.

### 3b. Delivery mechanism — inline, not a tail worker (decided)

Product/business server events deliver **inline** via `analyticsEvent` (`waitUntil(captureImmediate(...))`), not by emitting a structured `console.log` line for a Cloudflare **Tail Worker** to comb and forward. The tail route is rejected for _these_ events on three grounds:

1. **Delivery is weaker, not stronger.** Tail Workers are an observability mechanism — Cloudflare samples/drops tail events under load with no producer back-pressure or retry. Combing logs adds a second best-effort hop (producer→tail, then tail→PostHog) in front of the one event the spec flagged CRITICAL-not-to-drop (`order_placed`). Inline `waitUntil` keeps the isolate alive until the PostHog POST resolves and lets the outcome be observed — a stronger guarantee for the revenue event.
2. **It discards the typed call-site contract.** `analyticsEvent<E>` type-checks against `ServerEventProps`, so a renamed property fails to compile. A tail worker parses untyped JSON out of a log string — producer and consumer couple by a runtime format, and a dropped/renamed field silently stops appearing. That is _more_ of the agent-drift failure class this design exists to close, not less. It would also park user ids / PII in the worker log stream.
3. **It doesn't touch the hard half.** The identity/correlation work (client `identify()` bridge, `distinctId = user.id`, no-`alias()`) is orthogonal — a tail worker changes none of it. The only thing it saves is the `@si/kit/execution-context` ALS (§3), a ~15-line reuse of guestlist's existing pattern that other `waitUntil` needs share.

**Where a tail worker _is_ right (see §10):** _observability-derived_ signals nobody hand-instruments (5xx rates, latency) and a global **exception forwarder** — the server twin of client `capture_exceptions`. That is passive telemetry, a separate tier from hand-picked product events. **Escalation path:** if server-event volume ever needs delivery _decoupled from the request yet still guaranteed_, the answer is **Cloudflare Queues** (`waitUntil(queue.send())` → consumer with real retries/DLQ), not tail workers — deferred until volume warrants it.

## 4. Identity model — the distinctId contract

**The one rule:** `distinctId = better-auth session.user.id` — client and server, identity and store, forever. Never email, never an app-local id. `user.id` is stable and identical across both apps and across client/server, so one human collapses to exactly one PostHog person; `posthog-node` has no anonymous concept, so passing `user.id` server-side lands conversions on the same person the browser `identify()` created.

**One central hook** — `AnalyticsIdentityBridge`, composed _inside_ `AnalyticsProvider` in `@si/analytics/client`, driven by the route-context `session` both apps already expose. It replaces identity's ad-hoc `PostHogIdentifier`, gives store an identifier for the first time, and deletes every scattered per-button `reset()` / inline `identify()`. Per-action handlers keep firing `capture("signed_in")` etc. but must **not** identify.

```tsx
// packages/analytics/src/client.tsx   →  @si/analytics/client
export function AnalyticsProvider({
  app,
  session,
  children,
}: {
  app: AppName;
  session: PlatformSession | null;
  children: ReactNode;
}) {
  if (import.meta.env.ENVIRONMENT === "development") return <>{children}</>; // dev kill-switch
  return (
    <PostHogProvider
      apiKey={platformAnalyticsConfig.token}
      options={{
        api_host: platformAnalyticsConfig.host,
        person_profiles: "identified_only", // #1 free-tier lever: anon browsing stays cheap
        autocapture: false, // the typed registry is the ONLY event surface
        capture_pageview: "history_change", // SPA route changes
        capture_exceptions: true, // keeps the checkout captureException meaningful
        disable_session_recording: true, // biggest silent quota sink — off explicitly
        cross_subdomain_cookie: true, // www↔apex keep one distinct_id
        persistence: "localStorage+cookie",
        before_send: (e) =>
          e &&
          ((e.properties = { ...e.properties, app, environment: import.meta.env.ENVIRONMENT }), e), // app+env on EVERY event, race-free
      }}
    >
      <AnalyticsIdentityBridge session={session} />
      {children}
    </PostHogProvider>
  );
}

function AnalyticsIdentityBridge({ session }: { session: PlatformSession | null }) {
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog) return; // undefined during the very first render, before init
    const user = session?.user;
    if (user) {
      // Fire ONLY on a genuine transition TO user.id. get_distinct_id() reads the
      // PERSISTED id, so a returning logged-in user on a fresh load
      // (persisted === user.id) is skipped — no re-identify churn on reload.
      if (posthog.get_distinct_id() !== user.id) {
        // Direct A→B (token refresh / cross-tab re-login resolves session straight
        // to B, no null in between): posthog-js REFUSES identify()'s switch between
        // two identified persons, so clear A first. On a normal anon→identified
        // this is skipped (_isIdentified() === false), preserving the single merge.
        if (posthog._isIdentified()) posthog.reset();
        posthog.identify(
          user.id,
          {
            email: user.email,
            name: user.name,
            role: user.role,
            email_verified: user.emailVerified,
            two_factor_enabled: user.twoFactorEnabled,
            is_customer: user.stripeCustomerId != null, // boolean, NOT the raw Stripe id
            active_organization_id: session.session.activeOrganizationId,
          }, // $set — refreshed on each transition
          { initial_signup_at: user.createdAt, initial_app: app }, // $set_once — acquisition facts
        );
      }
      // group() is an identifying call too — fire only when the org actually changes.
      const orgId = session.session.activeOrganizationId;
      if (orgId && posthog.getGroups()?.organization !== orgId) {
        posthog.group("organization", orgId);
      }
    } else if (posthog._isIdentified()) {
      posthog.reset(); // identified → anonymous ONLY — catches expiry/revocation the buttons miss
    }
  }, [posthog, session?.user?.id, session?.session.activeOrganizationId]);
  return null;
}
```

The guard fires `identify()` **only on a genuine transition** to `user.id`. `posthog.get_distinct_id()` reads posthog-js's _persisted_ id (localStorage+cookie), so a returning logged-in user on a fresh load (persisted id already `=== user.id`) is skipped — no billable `$identify` churn on reload. `_isIdentified()` alone is the wrong predicate: it reports only that _some_ identify happened, not that it was _this_ user. On a shared computer with a **direct A→B switch** (a re-auth / token refresh / cross-tab re-login can resolve the route-context `session` straight from A to B with no intervening `null` render), calling `identify(B.id)` while posthog-js is already identified as A makes posthog-js **refuse the switch** and no-op — stranding the browser on person A while B's server events land on B. So when the predicate fires _and we're already identified as someone else_, `reset()` runs first (posthog-js's sanctioned account-switch path). The two reset paths — the `session === null` branch (through-logout: expiry/revocation/sign-out) and the reset-before-identify inside `if (user)` (direct A→B) — cover both shapes of an inter-user transition; neither fires on an ordinary anonymous load or a returning-user reload, so the no-churn property holds.

**Person properties on identified users** (all sourced from the `user`/`session` records — `workers/guestlist/src/schema.ts`). `$set` refreshes on each identify transition (current state); `$set_once` is written once and never overwritten (acquisition facts). Setting these is **consent-gated** (§9) — no PII reaches PostHog before opt-in.

| `$set` (current state)   | Source                          | Why                                                       |
| ------------------------ | ------------------------------- | --------------------------------------------------------- |
| `email`                  | `user.email`                    | support search / PII (deliberate — §10.7)                 |
| `name`                   | `user.name`                     | support search / PII                                      |
| `role`                   | `user.role`                     | operator/admin cohorts                                    |
| `email_verified`         | `user.emailVerified`            | verified-vs-not funnels                                   |
| `two_factor_enabled`     | `user.twoFactorEnabled`         | security-posture cohort                                   |
| `is_customer`            | `user.stripeCustomerId != null` | monetization segment (boolean, **not** the raw Stripe id) |
| `active_organization_id` | `session.activeOrganizationId`  | filter persons by org (mirrors the group)                 |

| `$set_once` (acquisition, immutable) | Source                | Why                                                            |
| ------------------------------------ | --------------------- | -------------------------------------------------------------- |
| `initial_signup_at`                  | `user.createdAt`      | cohort/age                                                     |
| `initial_app`                        | provider `app` prop   | which surface acquired them (`identity` vs `store`)            |
| `initial_signup_method`              | the `signed_up` event | how they first joined — set at the event, not identify (below) |

`initial_signup_method` is an acquisition fact tied to a specific moment, so it rides the signup event rather than every identify — `$set_once` attaches to any capture:

```tsx
capture("signed_up", { method, $set_once: { initial_signup_method: method } });
```

**Deliberately excluded** (the part that's easy to get wrong): no event-shaped/high-churn fields as person props — `order_count`, `last_order_total`, `cart_value`, `last_seen` churn the profile on every change and mislead as "current state"; compute them in PostHog from events (PostHog maintains `$last_seen` itself). Never `ipAddress`/`userAgent`/`token` (IP/UA ride client events for free; the token is a secret) or the raw `stripeCustomerId` (an external join key with no standalone analytic value). PostHog also **auto-manages** first-touch attribution (`$initial_referrer`, `$initial_utm_*`, …) as `$set_once` — do not hand-roll it.

- **Groups:** `organization` keyed on `session.session.activeOrganizationId`; identity surfaces + server `order_placed` when an org context exists; storefront browsing gets no group. `group()` is guarded on an actual org change so a re-render never churns a redundant `$groupidentify`. Association only — group _properties_ (name/plan/member_count) are a deferred `groupIdentify` from identity's org-admin surface where the org record is loaded (not the store client, which lacks org data).

### Identifier & aliasing strategy

**The identifier (single source of truth):** `distinctId = session.user.id` on **every** surface — client `identify()`, server delivery, both apps. Never `email`, never an app-local id, never the anonymous device id, never an org id (an org id both orphans the person _and_ collides with the `organization` group key). `user.id` is byte-identical across identity, store, client, and server, so one human collapses to exactly one PostHog person **by construction**; the only thing that can fragment a person is a _different_ string used somewhere, and no surface is permitted to produce one (§3a makes it unrepresentable-by-hand on the server; the bridge above is the only place it is set on the client).

**No `alias()` — ever.** `alias()` exists to reconcile _two different ids_ for one human; this model has exactly one id everywhere, so there is never a second id to link. It is also the specific footgun behind "alias re-called on every login/render": `alias()` is meant to run **at most once per person**, but it reads like "link these two ids," so it gets dropped on every login — and each call re-binds whatever the current id is, chaining ids and, once two _real_ users transitively link through a shared device, merging persons **irreversibly**. The correct anon→identified path is PostHog's automatic first-`identify()` merge (first-write-wins, one-directional); cross-app unification is _both_ apps independently calling `identify(user.id)`. `alias()` is banned project-wide — the reviewable rule is: **the string `.alias(` must not appear in the codebase.** (The public surfaces expose no `alias()` or server-side `identify()` either — both are traps: server-side `identify()` writes person props but performs no merge.)

### Correlation invariants (checklist)

Each is structurally enforced, not left to discipline:

| #   | Invariant                                                                                                                                                                   | Enforced by                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **One identifier everywhere** — the only id any surface produces is `session.user.id`.                                                                                      | Identifier rule; server made _unrepresentable-by-hand_ (`@si/analytics/server` exports no distinctId-taking fn; `deliverIdentified` is sealed in the package and reachable only via `analyticsEvent`, which hardcodes `session.user.id`); backed by the `vendor-boundary` deny test. |
| 2   | **Server events key off the auth-produced session, not a re-fetch** — `distinctId` and org group both derive from the same `context.session`.                               | §3a: `analyticsEvent` composes `.middleware([requireAuth])` and reads `context.session.user.id` / `.session.activeOrganizationId`.                                                                                                                                                   |
| 3   | **Client identifies exactly once per identity transition** — no re-identify churn on reload, no per-button `identify()`, and a direct A→B switch can't be silently refused. | §4 bridge: dedupe on `get_distinct_id() !== user.id`; `reset()`-before-`identify()` when already identified as a different person; `identify()` exists at no other call site.                                                                                                        |
| 4   | **No second id is ever minted or linked** — pre-login funnel joins via the automatic first-identify merge; cross-app via dual `identify(user.id)`.                          | No-`alias()` stance (banned project-wide); the public server surface has neither `identify()`/`alias()` nor a distinctId-capture; the anonymous path uses `$process_person_profile:false` + a throwaway id.                                                                          |
| 5   | **A person-scoped event with no session is unreachable**, and success-only firing is structural.                                                                            | §3a is auth-gated (anon → 401 before handler); `await next()` re-throws on failure/redirect so nothing emits on the error path; anonymous metrics use the separate `captureAnonymous` escape hatch.                                                                                  |

## 5. Event taxonomy & registry

**Naming rule (one):** `snake_case`, `object_verbed` — noun first, past-tense verb (`product_viewed`, `order_placed`, `cart_item_added`). Money is `*_cents`, ids are `*_id`, counts are `*_count`. Method/variant are **properties**, never event-name variants.

**Attachment happens in three layers**, so a `capture(event, props)` call only ever spells out the event-specific props:

1. **Automatic (we attach nothing).** On _client_ events PostHog autocaptures `$current_url`/`$pathname`/`$referrer`/UTM/`$browser`/`$os`/`$device_type`/`$session_id` and auto-manages first-touch person props (`$initial_referrer`, `$initial_utm_*`). _Server_ events (posthog-node) get none of this — only what we attach — which is intentional (lean, no GeoIP).
2. **Platform super properties (every event).** `app` (`identity`|`store`) and `environment` — client via `before_send` (§4, covers custom events + pageviews + exceptions with no race), server via the sealed `deliverIdentified`/`deliverAnonymous` core behind `analyticsEvent` (§3a). Optionally `app_release` (the per-worker release-please version) so a metric regression pins to a deploy. All are event properties.
3. **Event-specific properties** — the registry below. On the free tier, don't attach a property you won't slice by.

**Final event list** (keep the meaningful funnels; drop only genuine noise — _reject_ the 6-event over-pruning that discarded `checkout_failed`/`remove_from_cart`):

| Event                   | App / side         | Disposition                              | Properties                                                                                          |
| ----------------------- | ------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `signed_up`             | identity · client  | keep                                     | `{ method: "email"\|"passkey"\|"social" }`                                                          |
| `signed_in`             | identity · client  | **merge** `signed_in_with_passkey` in    | `{ method: "email"\|"passkey"\|"magic_link"\|"social" }`                                            |
| `magic_link_requested`  | identity · client  | keep                                     | `{}`                                                                                                |
| `signed_out`            | identity · client  | keep (reset handled by bridge)           | `{}`                                                                                                |
| `password_changed`      | identity · client  | keep                                     | `{}`                                                                                                |
| `account_deleted`       | identity · client  | keep                                     | `{}`                                                                                                |
| `product_viewed`        | store · client     | keep                                     | `{ product_id, product_slug, product_name, price_cents, in_stock }`                                 |
| `cart_item_added`       | store · client     | **rename** from `add_to_cart`            | `{ product_id, variant_id, product_name, size, price_cents }`                                       |
| `cart_item_removed`     | store · client     | **rename** from `remove_from_cart`       | `{ variant_id, product_name, size, price_cents, quantity }`                                         |
| `checkout_started`      | store · client     | keep                                     | `{ item_count, subtotal_cents, total_cents }`                                                       |
| `checkout_failed`       | store · client     | keep; `error`→**`reason`** (stable enum) | `{ reason, item_count, total_cents }`                                                               |
| `order_placed`          | store · **server** | keep (revenue truth server-side)         | `{ order_number, item_count, subtotal_cents, shipping_cents, total_cents }` + `groups.organization` |
| `cart_quantity_changed` | store · client     | **DROP**                                 | per-click volume burn; net deltas recompute from add/remove if ever needed                          |

Keep the one explicit `posthog.captureException` in the checkout catch (error tracking — its own quota line). `signup_method` may additionally be pinned as `$set_once` at the `signed_up` call site.

**Person property vs event:** identity facts that describe _who they are_ (`email`, `name`, `role`, `initial_signup_at`) are person properties (§4); anything describing _what happened_ (method, cart economics, order totals, `app`) is an event property.

**Typed registry** (the winning design calls for it — it structurally prevents the `signed_in` vs `signed_in_with_passkey` bug class):

```ts
// packages/analytics/src/events.ts   →  @si/analytics/events  (isomorphic, zero deps)
export const APP_NAMES = ["identity", "store"] as const;
export type AppName = (typeof APP_NAMES)[number];
export type CheckoutFailureReason = "payment_declined" | "out_of_stock" | "network" | "unknown";

export interface ClientEventProps {
  signed_up: { method: "email" | "passkey" | "social" };
  signed_in: { method: "email" | "passkey" | "magic_link" | "social" };
  magic_link_requested: Record<string, never>;
  signed_out: Record<string, never>;
  password_changed: Record<string, never>;
  account_deleted: Record<string, never>;
  product_viewed: {
    product_id: string;
    product_slug: string;
    product_name: string;
    price_cents: number;
    in_stock: boolean;
  };
  cart_item_added: {
    product_id: string;
    variant_id: string;
    product_name: string;
    size: string;
    price_cents: number;
  };
  cart_item_removed: {
    variant_id: string;
    product_name: string;
    size: string;
    price_cents: number;
    quantity: number;
  };
  checkout_started: { item_count: number; subtotal_cents: number; total_cents: number };
  checkout_failed: { reason: CheckoutFailureReason; item_count: number; total_cents: number };
}
export type ClientEvent = keyof ClientEventProps;

export interface ServerEventProps {
  order_placed: {
    order_number: string;
    item_count: number;
    subtotal_cents: number;
    shipping_cents: number;
    total_cents: number;
  };
}
export type ServerEvent = keyof ServerEventProps;
```

```ts
// consumed on the client via a typed hook — no more stringly-typed capture()
export const useCapture = () => {
  const posthog = usePostHog();
  return useCallback(
    <E extends ClientEvent>(event: E, props: ClientEventProps[E]) => posthog.capture(event, props),
    [posthog],
  );
};
```

**Free-tier leanness guidance:** `person_profiles:"identified_only"` (identified events cost ~4× anon; storefront browsing stays cheap until `identify()`), `autocapture:false` (the single biggest quota consumer — off, so the registry _is_ the whole documented surface), `disable_session_recording:true`, and the dev kill-switch keep local noise and replay out of the cap. Adding an event is a deliberate one-line edit to `events.ts`.

## 6. Env & config wiring

**Decision:** the token is a public `phc_` project key and the host a fixed URL — treat them as **code-consumed shared constants**, not env vars. This deletes the entire broken `import.meta.env.VITE_*` surface (criticals #3, #6). Add `packages/config/src/analytics.ts`:

```ts
export const platformAnalyticsConfig = {
  token: "phc_oyfb…", // public client/write key for project 501959 — safe to commit (like brand.name)
  host: "https://us.i.posthog.com",
} as const;
```

> Target project **501959** confirmed (the `phc_oyfb…` key currently in `.dev.vars`). The old HiPat project (262556) is retired — its PostHog MCP
> server has been removed from user config. Copy the exact `phc_oyfb…` value from `.dev.vars` when pinning the constant.

Re-export from `packages/config/src/index.ts` and add a `"./analytics"` entry to `@si/config`'s `exports`. `@si/config` is already imported client-side (`workers/identity/src/routes/__root.tsx`, `guestlist-brand.tsx`, `packages/ui/.../logo`), so it inlines into the browser bundle **and** the SSR bundle from one source — provably present in every env, never `undefined` behind a `!`. This becomes the 4th centralized-rebrand file alongside `brand.ts` / `deploy.ts` / `app-brand.ts`.

**Checklist of surfaces — what this design touches vs the naive env-var path (all of which are missing today, which is why it's broken):**

| Surface                                                           | Naive VITE\_ path             | This design                                                                                      |
| ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/config/src/analytics.ts` + index + `./analytics` export | —                             | **ADD** (single source)                                                                          |
| vite `CLIENT_VARS` (both apps)                                    | add 2 keys                    | **not needed** — plain module import inlines it                                                  |
| `wrangler.jsonc` staging + `env.production` vars                  | add 2 vars ×2 workers ×2 envs | **not needed** (optional `POSTHOG_KEY` only)                                                     |
| `.dev.vars` (both)                                                | keep                          | **REMOVE** the `VITE_PUBLIC_POSTHOG_*` lines (identity's is duplicated)                          |
| `docs/ops/env-vars.md`                                            | full row per var              | **ADD one note-row**: token/host are `@si/config` constants; only `ENVIRONMENT` gates activation |
| `ENVIRONMENT`                                                     | —                             | **already wired** — in both `CLIENT_VARS`; stamps `environment` + drives the dev kill-switch     |

**Optional per-env override (owner call, §10):** `@si/analytics/server` already prefers `env.POSTHOG_KEY` when set. To make it real, add a `POSTHOG_KEY` var/secret to each `wrangler.jsonc` + an `env-vars.md` row — lets a fork point staging/dev at a separate project without a code change. Default path stays the compiled constant.

## 7. Repo cleanup

- **Delete `posthog-setup-report.md`** (repo-root generation exhaust; its dashboard links even point at project `501959`, a _different_ project than the configured token — actively misleading).
- **Delete `.claude/skills/integration-tanstack-start/`** entirely — vendor scaffolding wizard (SKILL.md + 7 references incl. a 1193-line `EXAMPLE.md` + a 0-byte `.posthog-wizard` marker), not curated repo tooling like the other skills. No `.gitignore` rule needed once removed.
- **Delete both `workers/{store,identity}/src/lib/posthog-server.ts`** (byte-identical; identity's is dead/unimported) → replaced by `@si/analytics/server`.
- **Move all posthog deps into `@si/analytics`:** declare `@posthog/react`, `posthog-js` (fixes the undeclared hoisted peer, #7), `posthog-node` there (via `catalog:`); remove `@posthog/react`/`posthog-node` from both worker `package.json`s; `bun install` to reconcile `bun.lock`.
- **Collapse duplication:** the two inline `PostHogProvider` blocks → one `AnalyticsProvider`; guestlist's `plugins/execution-context.ts` → thin re-export of `@si/kit/execution-context`; fix store's cosmetic `<Scripts/>`-outside-provider placement.
- **Leave out of this PR:** the incidental `0.2.2/0.1.0 → 0.0.0` worker version-reset churn in the WIP diff — unrelated release-baseline noise; reconcile via release-please, don't smuggle it through analytics.

## 8. Migration plan

Grouped so it reviews/merges incrementally. **[C]** = pure cleanup/no-behavior-change; **[B]** = behavior-changing.

**A. Foundations (mergeable alone, no app behavior change)**

1. **[C]** Scaffold `packages/analytics` (`@si/analytics`) with `./events` `./client` `./server` subpaths; declare the three posthog deps from `catalog:`; peer `react` (+ optional `@tanstack/react-start`) mirroring `@si/kit`.
2. **[C]** Add `packages/config/src/analytics.ts` (`platformAnalyticsConfig`), re-export from index, add `./analytics` export. _(Pin the reconciled token — see §10 blocker.)_
3. **[C]** Author `@si/analytics/events` (typed registry above).
4. **[C]** Add `@si/kit/execution-context` (ALS + `runWithExecutionContext`); re-point guestlist to it (delete/re-export its plugin).

**B. Delivery path (server)** 5. **[B]** Wrap `workers/{store,identity}/src/worker.ts` `fetch` as `(request, env, ctx)` inside `runWithExecutionContext(ctx, …)`. 6. **[C]** Implement `@si/analytics/server`: internal `delivery.ts` (`deliverIdentified`/`deliverAnonymous`, `captureImmediate`+`waitUntil`, app/env stamping) + `analytics-event.ts` (`makeAnalyticsEvent`) + `index.ts` (public: `makeAnalyticsEvent`, `serverAnalytics().captureAnonymous` — **no** distinctId-taking export). Add the `vendor-boundary` deny test. 7. **[C]** Add each worker's `lib/middleware/analytics.ts` (`export const analyticsEvent = makeAnalyticsEvent({ app, requireAuth })`). 8. **[B]** Convert `orders.functions.ts` `order_placed` to the `.middleware([analyticsEvent("order_placed", …)])` seam (widen the success return to carry order economics) after `db.batch`; delete both `posthog-server.ts`.

**C. Client init + identity** 9. **[C]** Implement `@si/analytics/client` (`AnalyticsProvider` + `AnalyticsIdentityBridge` + `useCapture`). 10. **[B]** Swap both `__root.tsx` to a single `<AnalyticsProvider app session>`; delete `PostHogIdentifier`, inline option blocks, and scattered `reset()`/`identify()`. 11. **[B]** Migrate the 13 client call sites to `useCapture()`: merge passkey into `signed_in{method:"passkey"}`, rename cart events, `error→reason` enum, **delete both `cart_quantity_changed` handlers**.

**D. Config, deps, docs, tests** 12. **[C]** Remove posthog deps from worker `package.json`s (add `@si/analytics`); remove `VITE_PUBLIC_POSTHOG_*` from both `.dev.vars`; delete `posthog-setup-report.md` + the wizard skill; `bun install`. 13. **[C]** Add the `docs/ops/env-vars.md` note-row; `bun run types` per touched worker; `bun run check` from root. 14. **[B]** Update instrumented-call-site tests/mocks for renamed events and the `analyticsEvent` seam.

**E. Consent & compliance (§9)** 15. **[B]** Consent store: apex `.somewhatintelligent.ca` cookie (`si_analytics_consent`) with client read/write helpers + a server reader (from `getRequestHeaders()`); a consent banner + a "Privacy choices" control (shared UI, both apps). 16. **[B]** Gate the client: `opt_out_capturing_by_default: true` + `respect_dnt: true` in the provider; honor GPC; `opt_in_capturing()` only on a granted cookie; gate the identify bridge on `has_opted_in_capturing()`. 17. **[B]** Gate the server: `deliverIdentified` skips the send unless the request's consent cookie is `granted`. 18. **[B]** DSAR: on account deletion, enqueue a PostHog person delete (`POSTHOG_PERSONAL_API_KEY` secret + `env-vars.md` row); add the runbook. Update `/privacy` copy (legal review).

**F. Verify (staging/prod — local dev's separate origins cannot prove cross-app identity)** 19. Production build inlines the token into **both** client and SSR bundles (no `undefined`). On staging: (a) **before opt-in, zero events/cookies** fire (client and server); (b) after opt-in, one PostHog person spans `/account` and `/shop`; (c) a **store-first** checkout's funnel + `order_placed` land on that one person; (d) `order_placed` arrives reliably (`waitUntil`) even on a cold isolate; (e) events are segmentable by `app`/`environment`; (f) GPC/DNT suppresses capture; (g) account deletion removes the person; (h) no `development` events reach the project.

### Testing requirements

The correctness properties are structural/local by design, so **most are verifiable with mocks + static checks and no real PostHog key**. The enabler is one shared test double shipped from a `@si/analytics/testing` subpath and reused by both workers: a spy `PostHog` (node) whose `captureImmediate` records payloads, and a `usePostHog` spy exposing `identify`/`reset`/`get_distinct_id`/`getGroups`/`opt_in_capturing`/`has_opted_in_capturing`. Call-count/argument assertions on that double are how "no capture before consent", "identify exactly once", and "distinctId is always `user.id`" get proven. Tiering follows `.agents/skills/write-tests` (per-package unit vs `e2e/`).

| What to test                                                                                  | Tier                                                             | Real key? | How                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed registry                                                                                | `bun run check`                                                  | no        | a wrong event name/props, or `analyticsEvent` on a non-`ServerEventProps` event, fails to compile; `expectTypeOf` the `useCapture`/`analyticsEvent` signatures                                                                                                                                                              |
| Vendor boundary                                                                               | unit                                                             | no        | the fs-scan deny test already written in §3a                                                                                                                                                                                                                                                                                |
| `analyticsEvent` middleware                                                                   | unit (`vitest-pool-workers`)                                     | no        | mock `posthog-node`; assert **success-only** fire, **no emit on throw/redirect**, `distinctId===session.user.id`, `{app,environment}` stamped, org group when present, `ctx.waitUntil` when ALS seeded / `await` fallback otherwise, **skip when consent cookie ≠ granted**, anon path sets `$process_person_profile:false` |
| Identify bridge                                                                               | component (jsdom/happy-dom; add the setup if identity lacks one) | no        | mock `usePostHog`; assert identify-once-on-transition, **skip when `get_distinct_id()===user.id`**, reset-before-identify (A→B), reset-on-logout, `has_opted_in_capturing()` gate, `$set`/`$set_once` payload, group only on org change                                                                                     |
| Consent gate                                                                                  | unit + e2e                                                       | no        | unit: no capture call before opt-in, server delivery skipped without the cookie. e2e (Playwright, network-intercept): **zero requests to `*.posthog.com` before opt-in**, and GPC/decline stays silent                                                                                                                      |
| Config present + inlined                                                                      | unit + build                                                     | no        | token constant non-empty (guards finding #3); build-and-grep both the client and SSR bundles for the token                                                                                                                                                                                                                  |
| Person merge / dedup, consent actually suppressing ingest, DSAR delete, cross-subdomain unify | **staging manual**                                               | **yes**   | group F above — PostHog _ingestion_ behaviors that mocks cannot prove                                                                                                                                                                                                                                                       |

Definition of done mirrors the repo stance: a piece isn't done until its tier-appropriate test exists — server seams and the bridge test against the double; the consent-network property gets the e2e assertion; the ingestion truths are checked once on staging (F). **Nothing about the code's correctness is gated on a real key** — only the confirmation that PostHog ingests/merges as intended is. (Optional: one CI integration test against a _throwaway_ free project via an env-injected key, never committed.) Migration step 14 is what this section expands.

## 9. Privacy, consent & compliance (GDPR / CCPA / Law 25)

Users may fall under GDPR + ePrivacy (EU), CCPA/CPRA (California), or PIPEDA + Quebec **Law 25** (Canada — the platform is `.ca`). The compliant superset is **opt-in by default**: product analytics is non-essential profiling, which GDPR/ePrivacy and Law 25 require _prior consent_ for; opt-in also satisfies CCPA (an opt-out regime) provided we additionally honor the **Global Privacy Control** signal. So **nothing is captured until the user opts in**, GPC/DNT are a standing opt-out, and consent is revocable with a data-deletion path. This implements PostHog's documented consent pattern — the copy and legal bases still want a lawyer's eyes; this section specifies the _mechanics_, not the legal text.

### Consent model

- **Default = opted out.** No events, no persistent cookies, no `identify` until consent is granted.
- **Honor GPC/DNT** as an automatic opt-out (CCPA-required; harmless elsewhere).
- **One decision, both apps.** Consent is a first-party cookie on the apex (`.somewhatintelligent.ca`), so a choice made on `/account` or `/shop` covers both — and the workers can read it server-side. It rides the same cross-subdomain apex cookie story as the analytics `distinct_id`.
- **Revocable + erasable.** A "Privacy choices" control flips consent; account deletion erases the PostHog person.

### Client gate (extends the §4 provider)

PostHog inits opted-out; the provider promotes to opt-in only on a stored, still-valid grant:

```tsx
// inside AnalyticsProvider's PostHogProvider options (§4)
opt_out_capturing_by_default: true, // capture nothing, set no persistent cookie, until opt-in
respect_dnt: true,

// on mount, after init:
const gpc = typeof navigator !== "undefined" && (navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
if (!gpc && readConsentCookie() === "granted") posthog.opt_in_capturing();
```

- A **consent banner** renders while the decision is undecided (and GPC is absent). **Accept** → set the apex cookie `granted` + `posthog.opt_in_capturing()`; **Decline** → set cookie `denied`, stay opted out.
- **The identify bridge (§4) is gated on `posthog.has_opted_in_capturing()`** — no PII (`email`/`name`/…) reaches PostHog before consent. It re-runs on the consent→granted transition, so a user who accepts mid-session is identified then, not before.

### Server gate (extends §3a)

`deliverIdentified` (behind `analyticsEvent`) reads the same apex consent cookie from the request headers — already available via `getRequestHeaders()`, the mechanism `authMiddleware` uses — and **skips the send unless consent is `granted`**. A declined user's order still completes; it simply emits no `order_placed`. No consent ⇒ no person-scoped server event, and `captureAnonymous` is not a bypass (it writes no person).

### DSAR — access & erasure

- **Erasure on account deletion.** `delete-account-dialog` already `reset()`s locally; additionally the account-delete server path enqueues a **PostHog person delete** (the management API, authed with a `POSTHOG_PERSONAL_API_KEY` secret — _not_ the public write token) keyed on `user.id`. Ship a short runbook alongside `docs/runbooks/`.
- **Access/export** on request via PostHog's person API.
- Together these satisfy GDPR / CPRA / PIPEDA access + erasure rights.

### Data residency (decide before real EU traffic — §10)

The token targets **US cloud** (`us.i.posthog.com`). EU personal data on US cloud needs a transfer mechanism (PostHog's DPA + SCCs) _or_ a move to **PostHog EU Cloud** (`eu.i.posthog.com` — a separate project, re-pin the `@si/config` token).

### Privacy policy (`/privacy`, already routed in identity)

Disclose: analytics via PostHog (a processor), the categories collected (events + person props incl. `email`/`name`), purpose, legal basis (consent), retention, the US transfer, user rights (access / erasure / opt-out), and a link to change consent. Requirements only — route the actual copy through legal review.

## 10. Open questions / decisions for the owner

1. ~~**Target project reconciliation — BLOCKER before step A.2.**~~ **RESOLVED.** Target is project **501959** (`.dev.vars` `phc_oyfb…`). The HiPat project (262556) is retired and its PostHog MCP server has been removed from user config. Pin `phc_oyfb…` in `@si/config`.
2. **`env.POSTHOG_KEY` override — include it?** The server helper already prefers it. Wire the `wrangler` var/secret + `env-vars.md` row only if you want per-env/per-fork projects or key rotation without a redeploy. Default: pure `@si/config` constant.
3. **Reverse-proxy ingest through a bouncer `/ingest` mount — defer (recommended).** Recovers adblocked _client_ events but only by _raising_ free-tier quota pressure; server events egress directly and are unaffected. Owner call if a specific funnel's completeness ever demands it.
4. **Session replay OFF** — spec assumes `disable_session_recording:true`. Confirm you don't want replay on the free tier (it is the biggest silent quota consumer).
5. **Autocapture OFF** — spec assumes `autocapture:false` so the registry is the whole surface. Confirm the loss of exploratory click data is acceptable (reversible per-app).
6. **Dev capture OFF by default** — spec no-ops analytics when `ENVIRONMENT==="development"` so local dev doesn't pollute/burn the shared project. Confirm; a single flag opts a developer in.
7. **PII on person profiles** — `email` and `name` are set as person properties for support-searchability. Confirm intended.
8. **Observability tier via a Tail Worker — later, not now.** A separate Tail Worker for passive telemetry (5xx/latency) and a server-side exception forwarder (the twin of client `capture_exceptions`) is a good fit and a clean separate tier from the product events in this spec (§3b). Deferred: it needs the Workers Paid plan and a thinner local-dev story, and it's independent of everything here. Flag if you want it scoped as its own follow-up plan.
9. **Data residency — US cloud + SCCs, or EU cloud? (§9)** The pinned token is US cloud. For real EU traffic, either accept PostHog's DPA + SCCs on US cloud, or migrate the project to EU cloud (`eu.i.posthog.com`, re-pin the token). Decide before EU users are material.
10. **Declined-consent behavior — nothing, or memory-only?** Spec assumes a declined user is fully opted out (no analytics). PostHog also supports `persistence:"memory"` (in-session, cookieless) as a middle ground. Confirm "nothing" is intended.
11. **Consent banner UX + copy — needs legal review.** Placement (both apps), granularity (single analytics toggle vs. categories), and the actual banner/privacy-policy wording are a product + legal call, not specified here.
