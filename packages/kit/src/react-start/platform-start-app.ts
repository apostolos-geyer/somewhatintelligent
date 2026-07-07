/**
 * `createPlatformStartApp` — thin compositor that ties together the
 * platform's session + envelope + cross-worker primitives behind one
 * import surface, so apps don't repeat the wiring.
 *
 * Two distinct ways to ask "who is the request?" — kept as separate
 * functions because the answers are different types:
 *
 *   - `getEnvelope(headers)` returns the signed, narrow envelope payload
 *     ({ actor, session } with id/role/name/email/image + id/userId/expiresAt).
 *     No I/O. Use for auth gates, log correlation, header chrome — anywhere
 *     you only need identity. Verifier still runs (prod: throws 403 on
 *     missing/invalid; dev: returns null) and feeds request-context.
 *
 *   - `getSession(headers)` returns the BA-inferred full `PlatformSession`
 *     by RPC to guestlist. Use for plugin-extended fields (`twoFactorEnabled`,
 *     `createdAt`, `username`, etc.). Envelope is verified as a
 *     precondition; guestlist is the source of truth.
 *
 * Apps wire `getGuestlist` via `createGuestlistFactory` and pass it in here
 * alongside the env-label thunk. Kit builds the bouncer envelope verifier
 * lazily on first server-only call (env access cannot happen at module-eval
 * time — that leaks values into the client bundle).
 */
import { createServerOnlyFn } from "@tanstack/react-start";
import {
  createBouncerEnvelopeVerifier,
  EnvelopeRejection,
  PLATFORM_HEADERS,
  type EnvelopeData,
  type EnvelopeResult,
  type BouncerEnvelopeVerifier,
  type PlatformEnvironment,
  type PlatformSession,
} from "@si/auth";
import { BOUNCER_ATTESTATION_KEYS } from "@si/config";
import { getRequestContext, updateRequestContext } from "../request-context";
import { createAuthContext } from "../react/auth";
import { createReactStartAuthProvider } from "./auth-provider";
import { createEnvelopeMiddleware } from "./envelope-middleware";
import { createDevEnvelopeStamper, type DevEnvelopeStamper } from "./dev-envelope";

/** Generic guestlist-client shape — kit needs `.getSession()`. */
interface GuestlistClientShape {
  getSession: () => Promise<PlatformSession | null>;
}

export interface PlatformStartAppOpts<C extends GuestlistClientShape> {
  /** App identifier (`"identity"`, etc.). Threaded into the apiProxyHandlers' `x-platform-caller` header. */
  name: string;
  /** Pre-built `getGuestlist` from `createGuestlistFactory`. */
  getGuestlist: () => C;
  /**
   * `createServerOnlyFn`-wrapped fetcher into the guestlist service binding —
   * the same thunk apps pass to `createGuestlistFactory` as `fetcher`.
   * Used by `apiProxyHandlers` to forward raw HTTP to guestlist without
   * recreating the guestlist client.
   */
  guestlistFetcher: () => typeof fetch;
  /**
   * `createServerOnlyFn`-wrapped env-label thunk. Apps construct via:
   *
   *   import { env } from "cloudflare:workers";
   *   import { createServerOnlyFn } from "@tanstack/react-start";
   *
   *   getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT)
   *
   * Kit invokes it only inside server-only paths — never at module load.
   */
  getEnvironment: () => string;
  /**
   * Optional. Host the bouncer envelope is verified against. Default reads
   * `new URL(req.url).hostname` per request. Apps reached via a bouncer
   * service-binding loopback (which rewrites `Host` to the miniflare port
   * in dev) should pin to the public host — typically
   * `new URL(env.APP_URL).hostname`. Accepts a string or `(req) => string`.
   */
  expectedHost?: string | ((req: Request) => string);
  /**
   * Optional. When supplied, kit constructs a `devEnvelopeStamper` that
   * apps invoke at their worker entry to self-mint a bouncer envelope on
   * dev-direct requests (Appendix A of `docs/ARCHITECTURE.md` — public
   * hosts hit the app without bouncer in front, so `x-platform-att` would
   * otherwise be absent and every `getEnvelope` call would null out).
   *
   * Hard non-dev no-op: the returned stamper short-circuits unless
   * `getEnvironment()` returns `"development"`. See `dev-envelope.ts`
   * for the safety rationale.
   *
   * Apps wire it as:
   *
   *   const stamped = await platform.devEnvelopeStamper?.(request) ?? request;
   *   return startEntry.fetch(stamped, { context });
   */
  devEnvelopeSigner?: () => { privPem: string; kid: string };
  /**
   * Optional. Per-request guestlist client builder for the dev envelope
   * stamper. Apps mint a fresh client with cookies read directly from the
   * incoming `Request` (not from TSS's H3 context — the stamper runs at
   * the worker boundary, BEFORE TSS captures its H3 event, so the default
   * `getGuestlist()` factory's cookie reader sees no cookies).
   *
   * When omitted, the stamper falls back to `getGuestlist()` and will mint
   * `actor: null` envelopes in dev-direct topology — usable for public
   * endpoints but not for `getEnvelope`-strict server fns.
   */
  devEnvelopeGuestlist?: (request: Request) => C;
}

export function createPlatformStartApp<C extends GuestlistClientShape>(
  opts: PlatformStartAppOpts<C>,
) {
  const {
    name,
    getGuestlist,
    guestlistFetcher,
    getEnvironment,
    expectedHost,
    devEnvelopeSigner,
    devEnvelopeGuestlist,
  } = opts;

  // Lazy verifier — first call inside a server-only path constructs and
  // caches it. Env access (the ENVIRONMENT label) happens only inside the
  // server-only chain.
  const resolveHost: (req: Request) => string =
    typeof expectedHost === "string"
      ? () => expectedHost
      : typeof expectedHost === "function"
        ? expectedHost
        : (req) => new URL(req.url).hostname;
  let _verifier: BouncerEnvelopeVerifier | null = null;
  function getVerifier(): BouncerEnvelopeVerifier {
    if (_verifier) return _verifier;
    _verifier = createBouncerEnvelopeVerifier({
      keys: BOUNCER_ATTESTATION_KEYS,
      env: getEnvironment() as PlatformEnvironment,
      expectedHost: (req) => resolveHost(req).toLowerCase(),
    });
    return _verifier;
  }

  // Per-Headers memoization for both lookups so N callers in one TSS
  // request share at most one verify + at most one guestlist RPC.
  const envelopeInflight = new WeakMap<Headers, Promise<EnvelopeResult>>();
  const sessionInflight = new WeakMap<Headers, Promise<PlatformSession | null>>();
  const activeOrgInflight = new WeakMap<Headers, Promise<string | null>>();

  // Verify the envelope, feed request-context off the result, and surface
  // a 403 Response in prod when the verifier rejected. Shared precondition
  // for both `getEnvelope` and `getSession`.
  //
  // `createServerOnlyFn`-wrapped so TSS replaces the body with a throwing
  // stub in the client bundle. Without the wrap, the closure's references
  // to `getRequestContext` / `updateRequestContext` would keep
  // `kit/request-context` reachable from any client module that imports
  // `createPlatformStartApp` (every app reaches it via `lib/platform.ts` →
  // `__root.tsx` → `loadSession`), pulling `new AsyncLocalStorage()` into
  // the browser bundle.
  const verifyAndContextualise = createServerOnlyFn(async function verifyAndContextualise(
    headers: Headers,
  ): Promise<EnvelopeResult> {
    const cached = envelopeInflight.get(headers);
    if (cached) return cached;
    const promise = (async (): Promise<EnvelopeResult> => {
      const host = headers.get("host") ?? "__platform__.invalid";
      const realRequest = new Request(`https://${host}/`, { headers });
      let result: EnvelopeResult;
      try {
        result = await getVerifier()(realRequest);
      } catch (err) {
        if (err instanceof EnvelopeRejection) {
          throw new Response(`Forbidden: ${err.reason}`, {
            status: 403,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        throw err;
      }
      if (result.kind === "valid" && result.actor && getRequestContext()) {
        updateRequestContext({ actorKind: "user", actorId: result.actor.id });
      }
      return result;
    })();
    envelopeInflight.set(headers, promise);
    return promise;
  });

  /**
   * Fast path. Verifies the signed envelope and returns its narrow payload —
   * or `null` for a public/optional request that has no actor. No guestlist
   * I/O.
   */
  const getEnvelope = createServerOnlyFn(async function getEnvelope(
    headers: Headers,
  ): Promise<EnvelopeData | null> {
    const result = await verifyAndContextualise(headers);
    if (result.kind !== "valid") return null;
    // Verifier enforces actor null ↔ session null.
    if (!result.actor || !result.session) return null;
    return { actor: result.actor, session: result.session };
  });

  /**
   * Full BA-inferred `PlatformSession` by RPC to guestlist. Envelope is
   * verified as a precondition (prod throws on missing/invalid). Returns
   * `null` when the user is unauthenticated.
   */
  const getSession = createServerOnlyFn(function getSession(
    headers: Headers,
  ): Promise<PlatformSession | null> {
    const cached = sessionInflight.get(headers);
    if (cached) return cached;
    const promise = (async () => {
      const result = await verifyAndContextualise(headers);
      // The envelope is the authoritative, locally-verified (no-I/O) answer to
      // "is this request authenticated?"; the guestlist RPC only ENRICHES it to
      // the full BA session. So a valid envelope with an actor means the caller
      // IS signed in even if guestlist blips.
      const envelopeAuthed = result.kind === "valid" && result.actor != null;
      let session: PlatformSession | null = null;
      try {
        session = await getGuestlist().getSession();
      } catch {
        // A transient RPC failure must NOT be conflated with sign-out: returning
        // null here bounces a valid signed-in user out of SSR-gated loaders
        // (e.g. identity's admin `beforeLoad`, which redirects on
        // `!context.session`) — a redirect the client's later
        // `authClient.useSession()` reconcile (D4a) can't undo. When the
        // envelope proves the caller is authenticated, retry once before giving
        // up; only a sustained failure yields null. Unauthenticated / dev-direct
        // requests keep the original single-attempt behavior.
        if (envelopeAuthed) {
          try {
            session = await getGuestlist().getSession();
          } catch {
            session = null;
          }
        }
      }
      if (getRequestContext() && session) {
        updateRequestContext({ actorKind: "user", actorId: session.user.id });
      }
      return session;
    })();
    sessionInflight.set(headers, promise);
    return promise;
  });

  /**
   * Active organization id for the current request (string) or `null`. Reads
   * from the verified envelope's `activeOrgId` projection of
   * `session.activeOrganizationId`. Role isn't denormalized — server fns
   * that need it call `authClient.organization.getActiveMemberRole`.
   *
   * Dev-only fallback: when the envelope verifier returns `invalid`/`missing`
   * (dev-direct topology with no bouncer), fall back to reading
   * `session.activeOrganizationId` directly via the existing getSession
   * RPC. No separate guestlist hop.
   */
  const getActiveOrgId = createServerOnlyFn(function getActiveOrgId(
    headers: Headers,
  ): Promise<string | null> {
    const cached = activeOrgInflight.get(headers);
    if (cached) return cached;
    const promise = (async () => {
      const result = await verifyAndContextualise(headers);
      if (result.kind === "valid") return result.activeOrgId;
      if (getEnvironment() !== "development") return null;
      try {
        const session = await getGuestlist().getSession();
        return (
          (session?.session as { activeOrganizationId?: string | null } | undefined)
            ?.activeOrganizationId ?? null
        );
      } catch {
        return null;
      }
    })();
    activeOrgInflight.set(headers, promise);
    return promise;
  });

  /**
   * Envelope-driven global middleware (zero-hop). Apps install this in
   * `start.ts`'s `requestMiddleware` to surface `ctx.principal` to every
   * server fn / server route without an RPC. The verifier is the same lazy
   * instance `getEnvelope` uses; TSS dedupes by reference when this
   * middleware appears in the chain.
   *
   * See `docs/REQUEST-FLOW.md` §9.0.1 — `loadSession` remains available for
   * client-side AuthProvider seeding.
   */
  const envelopeMiddleware = createEnvelopeMiddleware({ getVerifier });

  // Dev-only envelope stamper. Built only when an app explicitly threads a
  // signer through `devEnvelopeSigner`; the stamper itself is also gated on
  // `getEnvironment() === "development"` (see SAFETY in `dev-envelope.ts`).
  const devEnvelopeStamper: DevEnvelopeStamper | undefined = devEnvelopeSigner
    ? createDevEnvelopeStamper({
        getEnvironment,
        getSigner: devEnvelopeSigner,
        getGuestlist: devEnvelopeGuestlist ?? (() => getGuestlist()),
        ...(expectedHost !== undefined && { expectedHost }),
      })
    : undefined;

  /**
   * Builds the `<AuthProvider>` + `useAuth` pair. Called from app code
   * after defining `loadSession` (a top-level `createServerFn` per the
   * TSS compiler constraint).
   */
  function makeAuthProvider(loadSession: () => Promise<PlatformSession | null>) {
    const authContext = createAuthContext<PlatformSession>();
    return {
      AuthProvider: createReactStartAuthProvider<PlatformSession>({ authContext, loadSession }),
      useAuth: authContext.useAuth,
    };
  }

  /**
   * Reverse-proxy `/api/$` (the catch-all) to guestlist. Browser thinks it's
   * same-origin: cookies attach automatically, no CORS preflight. Uses
   * the same guestlist fetcher as `getGuestlist` so the binding-injection
   * pattern is unified.
   *
   *   export const Route = createFileRoute("/api/$")({
   *     server: { handlers: platform.apiProxyHandlers },
   *   });
   */
  const proxy = createServerOnlyFn(async function proxy(request: Request): Promise<Response> {
    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "guestlist.internal";
    const inner = new Request(url, request);

    const ip = request.headers.get("cf-connecting-ip");
    if (ip) {
      const fwd = inner.headers.get("x-forwarded-for");
      inner.headers.set("x-forwarded-for", fwd ? `${ip}, ${fwd}` : ip);
    }

    // Forward platform contract for log correlation only.
    const ctx = getRequestContext();
    if (ctx?.requestId) inner.headers.set(PLATFORM_HEADERS.rid, ctx.requestId);
    inner.headers.set(PLATFORM_HEADERS.caller, name);
    if (ctx?.actorKind) inner.headers.set(PLATFORM_HEADERS.actor.kind, ctx.actorKind);
    if (ctx?.actorId) inner.headers.set(PLATFORM_HEADERS.actor.id, ctx.actorId);

    return guestlistFetcher()(inner);
  });

  const apiProxyHandlers = {
    GET: ({ request }: { request: Request }) => proxy(request),
    POST: ({ request }: { request: Request }) => proxy(request),
    PUT: ({ request }: { request: Request }) => proxy(request),
    PATCH: ({ request }: { request: Request }) => proxy(request),
    DELETE: ({ request }: { request: Request }) => proxy(request),
    OPTIONS: ({ request }: { request: Request }) => proxy(request),
    HEAD: ({ request }: { request: Request }) => proxy(request),
  };

  return {
    name,
    getEnvelope,
    getSession,
    getActiveOrgId,
    getGuestlist,
    envelopeMiddleware,
    apiProxyHandlers,
    makeAuthProvider,
    devEnvelopeStamper,
  };
}
