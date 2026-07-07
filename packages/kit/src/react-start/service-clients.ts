/**
 * Service-client factories for TanStack Start apps.
 *
 * Three DI-correct factories — kit owns no concrete guestlist/roadie client
 * type. Apps inject the constructor (`createGuestlistClient`, `createRoadieClient`)
 * so kit doesn't take a dependency on platform service packages. Cookie
 * adapters, request-id and actor wiring are sourced from kit primitives
 * (`@tanstack/react-start/server`, `@greenroom/kit/request-context`).
 *
 * All three return `createServerOnlyFn`-wrapped callables: importing the
 * surface from a route file (which bundles for both client and server) is
 * safe; calling it from the client throws.
 */
import { createServerOnlyFn } from "@tanstack/react-start";
import { getCookies, getRequest, setCookie } from "@tanstack/react-start/server";
import {
  extractRequestId,
  getRequestContext,
  updateRequestContext,
  type Actor,
} from "../request-context";

// --- Guestlist ----------------------------------------------------------------

/**
 * Caller-supplied factory for the guestlist client. Apps pass
 * `createGuestlistClient` from `@greenroom/guestlist-service/client` (kit doesn't
 * depend on it directly).
 */
type GuestlistClientFactory<C> = (opts: {
  baseURL: string;
  callerApp: string;
  fetchOptions: {
    customFetchImpl: typeof fetch;
    headers?: Record<string, string>;
  };
  cookies: {
    getAll: () => ReadonlyArray<{ name: string; value: string }>;
    setAll: (
      cookies: ReadonlyArray<{
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }>,
    ) => void;
  };
  getRequestId: () => string;
  getActor: () => Actor | null;
}) => C;

export interface GuestlistFactoryOpts<C> {
  /** App identifier (`"identity"`, `"sprout"`, etc.). Threaded into guestlist logs as `caller_app`. */
  callerApp: string;
  /** App-supplied guestlist client constructor. */
  createClient: GuestlistClientFactory<C>;
  /**
   * Thunk returning a fetch implementation. Apps typically pass
   * `() => env.GUESTLIST.fetch.bind(env.GUESTLIST)` so the binding lookup happens
   * lazily inside the server-only path.
   */
  fetcher: () => typeof fetch;
  /**
   * Optional baseURL override. Defaults to `"http://guestlist.internal"` (the
   * placeholder used for service-binding routing).
   */
  baseURL?: string;
}

/**
 * Build an app's `getGuestlist` factory.
 *
 * Returns `(originRequest?: Request) => C` wrapped in `createServerOnlyFn`.
 * Pass `originRequest` when calling Better Auth mutations from a server-route
 * handler to forward the inbound `Origin` header (BA's CSRF check requires
 * it on POST routes).
 */
export function createGuestlistFactory<C>(opts: GuestlistFactoryOpts<C>) {
  const { callerApp, createClient, fetcher, baseURL = "http://guestlist.internal" } = opts;

  return createServerOnlyFn((originRequest?: Request): C => {
    const origin = originRequest?.headers.get("origin") ?? undefined;
    return createClient({
      baseURL,
      callerApp,
      fetchOptions: {
        customFetchImpl: fetcher(),
        ...(origin && { headers: { origin } }),
      },
      cookies: {
        getAll: () => Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies) {
            setCookie(name, value, options as Parameters<typeof setCookie>[2]);
          }
        },
      },
      getRequestId: () => extractRequestId(getRequest()),
      getActor: () => {
        const ctx = getRequestContext();
        return ctx?.actorKind === "user" && ctx.actorId
          ? { kind: "user", userId: ctx.actorId }
          : null;
      },
    });
  });
}

// --- Roadie -----------------------------------------------------------------

/**
 * Caller-supplied factory for the roadie client. The exact `Binding` and
 * `RoadieActor` types live in `@greenroom/roadie-service/client`; kit takes
 * `Binding` as a generic so no import is needed here.
 */
type RoadieClientFactory<C, B> = (
  binding: B,
  opts: {
    callerApp: string;
    getRequestId: () => string;
    getActor: () => RoadieActorLike;
  },
) => C;

/**
 * Mirror of `RoadieActor` from `@greenroom/roadie-service/client`. Kit doesn't
 * import the platform package, so we restate the union here. Apps pass the
 * real type via the generic `C`/`B`.
 */
type RoadieActorLike =
  | { kind: "user"; userId: string }
  | { kind: "service"; serviceName: string }
  | { kind: "anonymous"; label: string };

export interface RoadieFactoryOpts<C, B> {
  /** App identifier — sets `meta.callerApp` and forms the anon-actor service prefix. */
  callerApp: string;
  /** App-supplied roadie client constructor. */
  createClient: RoadieClientFactory<C, B>;
  /** Thunk returning the roadie service binding (`() => env.ROADIE`). */
  getBinding: () => B;
  /**
   * Optional anonymous-actor label deriver. When set and the request has no
   * authenticated user, the returned label feeds `{ kind: "anonymous", label }`.
   * Defaults to `"unauthenticated"`.
   */
  deriveAnonymousLabel?: (request: Request) => string;
}

/**
 * Build an app's `getRoadie` factory.
 *
 * Returns `() => C` wrapped in `createServerOnlyFn`. Lazy: the binding
 * thunk and any per-request state (active request, ALS context) are read
 * each call, so the same factory works across requests in a single CF
 * isolate.
 */
export function createRoadieFactory<C, B>(opts: RoadieFactoryOpts<C, B>) {
  const { callerApp, createClient, getBinding, deriveAnonymousLabel } = opts;

  return createServerOnlyFn((): C => {
    return createClient(getBinding(), {
      callerApp,
      getRequestId: () => extractRequestId(getRequest()),
      getActor: (): RoadieActorLike => {
        const ctx = getRequestContext();
        if (ctx?.actorKind === "user" && ctx.actorId) {
          return { kind: "user", userId: ctx.actorId };
        }
        const label = deriveAnonymousLabel?.(getRequest()) ?? "unauthenticated";
        return { kind: "anonymous", label };
      },
    });
  });
}

// --- Session ----------------------------------------------------------------

export interface SessionFactoryOpts<S extends { user: { id: string; role?: string | null } }> {
  /**
   * Guestlist fallback session reader. Apps wire
   * `() => getGuestlist().getSession()`. Errors are swallowed and treated as
   * unauthenticated.
   */
  getGuestlistFallback: () => Promise<S | null>;
}

/**
 * Build an app's `getSession` server-only reader.
 *
 * `getSession(headers)` is WeakMap-memoised per Headers reference (so N
 * callers in the same request share at most one guestlist service-binding RPC).
 * On success, the resolved actor is patched into the active request-context
 * ALS so canonical log lines emit with `actor_*` populated.
 *
 * In the target topology, the bouncer attestation envelope is the fast path
 * — apps that wire `createPlatformStartApp` get envelope-first resolution
 * for free. This raw factory exists for the non-Start path and for apps that
 * want to compose `getSession` manually.
 *
 * **`loadSession` is intentionally NOT shipped from the kit**: TSS's compile
 * plugin requires `createServerFn(...).handler(...)` to live at module
 * top-level (see start-plugin-core's handleCreateServerFn). Wrapping it
 * inside this factory body confuses the AST extraction. Apps build their
 * own `loadSession` in a `lib/session.functions.ts` file instead:
 *
 * ```ts
 * import { createServerFn } from "@tanstack/react-start";
 * import { getRequestHeaders } from "@tanstack/react-start/server";
 * import { platform } from "@/lib/platform";
 *
 * export const loadSession = createServerFn({ method: "GET" }).handler(
 *   async () => platform.getSession(getRequestHeaders()),
 * );
 * ```
 */
export function createSessionFactory<S extends { user: { id: string; role?: string | null } }>(
  opts: SessionFactoryOpts<S>,
) {
  const { getGuestlistFallback } = opts;

  // Per-request memoization. The Headers reference is stable across all
  // reads inside one TanStack request (single `getRequest()` instance), so
  // caching the promise on the Headers means N callers share one guestlist
  // service-binding RPC. Across requests the Headers object is GC'd and the
  // entry vanishes.
  const inflight = new WeakMap<Headers, Promise<S | null>>();

  return createServerOnlyFn(function getSession(headers: Headers): Promise<S | null> {
    const cached = inflight.get(headers);
    if (cached) return cached;
    const promise = (async () => {
      let session: S | null = null;
      try {
        session = await getGuestlistFallback();
      } catch {
        session = null;
      }
      if (getRequestContext() && session) {
        updateRequestContext({ actorKind: "user", actorId: session.user.id });
      }
      return session;
    })();
    inflight.set(headers, promise);
    return promise;
  });
}
