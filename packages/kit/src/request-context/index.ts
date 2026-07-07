/**
 * Request-scoped context — request_id, actor, callerApp — propagated via
 * AsyncLocalStorage. Distinct from `@greenroom/kit/log`'s `logStorage`
 * (which holds the CanonicalLogBuilder for the active emit scope) — this
 * holds the request-level identity that any number of canonical-log lines
 * inside the same request might want to read.
 *
 * Why two ALSes:
 *   - logStorage scope opens/closes per `withCanonicalLog` call (often
 *     once per RPC method, server-fn, or HTTP handler).
 *   - requestContextStorage scope opens/closes per inbound request and
 *     persists across multiple log emissions inside that request.
 *
 * Consumers open the scope at the fetch boundary:
 *
 *   import { withRequestContext, getRequestId } from "@greenroom/kit/request-context";
 *   import { ulid } from "@greenroom/kit/ids";
 *
 *   export default {
 *     async fetch(request, _env, ctx) {
 *       const requestId = request.headers.get("cf-request-id") ?? ulid();
 *       return withRequestContext({ requestId }, () => app.fetch(request));
 *     },
 *   };
 *
 * Then anywhere in the request lifecycle:
 *
 *   const requestId = getRequestId();  // reads from ALS, no parameter threading
 *
 * This is the minimal primitive. `withCanonicalLog` may grow to read
 * request_id from this storage when its ctx arg doesn't supply one
 * (cleaner boundary instrumentation), but that's a follow-up — for now
 * boundary wrappers pass request_id explicitly.
 */
/// <reference types="node" />
// Namespace import (not `{ AsyncLocalStorage }`) so Vite's client transform
// doesn't emit a top-level `stub["AsyncLocalStorage"]` property access. The
// kit/react-start barrel is reachable from app client bundles in dev via
// `.middleware([...])` runtime references that TSS can't strip; the named
// destructure form crashes the browser at module init because Vite
// externalizes `node:async_hooks` to a Proxy that throws on any get. The
// namespace binding stays inert until `storage()` is called server-side.
import * as nodeAsyncHooks from "node:async_hooks";
import type { AsyncLocalStorage as ALS } from "node:async_hooks";
import { ulid } from "../ids";

/**
 * Adopt a request id from inbound headers, falling back to a fresh ULID.
 * Prefers an already-open `withRequestContext` scope so calls made deep in
 * the request lifecycle return the same id the boundary adopted; falls
 * back to header probe (`cf-request-id`, then `x-request-id`) and finally
 * a synthesized ulid.
 *
 * **Use this only at bouncer's public-edge boundary** — bouncer is the
 * platform's sole translator of `cf-*` headers. Every other worker (apps
 * + internal services) reaches request context via `extractPlatformRequestId`
 * below, which speaks the internal `x-platform-rid` contract.
 *
 *   import { extractRequestId } from "@greenroom/kit/request-context";
 *   const requestId = extractRequestId(request);
 */
export function extractRequestId(req: Request): string {
  return (
    storage().getStore()?.requestId ??
    req.headers.get("cf-request-id") ??
    req.headers.get("x-request-id") ??
    ulid()
  );
}

/**
 * Adopt a request id from the platform's internal header contract.
 *
 * Reads `x-platform-rid` (set by bouncer, or by an upstream platform worker
 * forwarding through service binding), otherwise mints a fresh ULID. The
 * canonical reader for any worker that participates in the platform but is
 * not the public-edge bouncer — apps, guestlist, roadie, promoter — should
 * use this rather than `extractRequestId`.
 *
 * Apps run alone in development without bouncer in front; in that topology
 * there is no `x-platform-rid`, the mint branch fires, and logs key off the
 * minted id for the lifetime of that one request.
 *
 *   import { extractPlatformRequestId } from "@greenroom/kit/request-context";
 *   const requestId = extractPlatformRequestId(request);
 */
export function extractPlatformRequestId(req: Request): string {
  return storage().getStore()?.requestId ?? req.headers.get("x-platform-rid") ?? ulid();
}

/**
 * THE canonical "extract the routing host from a request" rule — the single
 * definition shared by bouncer (the public-edge ingress), the dev-envelope
 * stamper that emulates it, and the apps that resolve a host → brand. One place,
 * so the envelope's attested host, the edge routing decision, and an app's
 * host→brand lookup can never disagree.
 *
 * `x-forwarded-host` is the proxy's signal for the ORIGINAL client host (portless
 * in dev rewrites `Host` to the proxy target and moves the real host here).
 * Trusting it in production would let a client spoof the routing host, so it is
 * honored ONLY when `trustForwardedHost` is set (development). Lowercased,
 * port-stripped; null when nothing resolves.
 */
export function routingHostFromHeaders(
  headers: { get(name: string): string | null },
  opts: { trustForwardedHost: boolean; fallbackHost?: string | null },
): string | null {
  const forwarded = opts.trustForwardedHost ? headers.get("x-forwarded-host") : null;
  const raw = forwarded ?? headers.get("host") ?? opts.fallbackHost ?? null;
  return raw ? raw.toLowerCase().split(":")[0]! : null;
}

/**
 * Narrow Actor kind for service-binding RPC. Apps may have richer actor
 * models at their own boundary (e.g. `anonymous` for unauthenticated transfer
 * viewers); they fold those into `user` or `service` when calling RPC.
 */
export type Actor = { kind: "user"; userId: string } | { kind: "service"; serviceName: string };

export interface RequestContext {
  /** Request ID. Adopted from `cf-request-id` (or W3C traceparent) at the entry Worker, propagated through every layer. */
  requestId: string;
  /** Actor identity kind — typically `"user" | "service" | "anonymous"`. */
  actorKind?: string;
  /** Actor identifier — userId for user actors, serviceName for service actors, label for anonymous. Null when unresolved. */
  actorId?: string | null;
  /** For RPC events: which app/service called this method. */
  callerApp?: string;
  /** W3C Trace Context — paves the path to OTEL adoption. Free now (just propagated as-is). */
  traceparent?: string;
}

let _storage: ALS<RequestContext> | undefined;
function storage(): ALS<RequestContext> {
  return (_storage ??= new nodeAsyncHooks.AsyncLocalStorage<RequestContext>());
}

/**
 * Open a request-scoped context. The fn (and everything in its async
 * call stack) can read the context via `getRequestContext()`,
 * `getRequestId()`, etc. The scope closes when fn resolves; nested
 * `withRequestContext` calls shadow the outer (inner returns its own
 * context until it closes).
 */
export function withRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return storage().run(ctx, fn);
}

/**
 * Patch the active request context in place. Useful at the boundary when
 * the request id is known immediately but actor info isn't resolved until
 * after a session lookup — open the scope with `{ requestId }` first so
 * any I/O during resolution sees the id, then `updateRequestContext({
 * actorKind, actorId })` once the lookup returns. ALS stores a reference,
 * so all readers downstream see the mutation. Throws if called outside
 * a scope.
 */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const ctx = storage().getStore();
  if (!ctx) {
    throw new Error("updateRequestContext called outside any withRequestContext scope");
  }
  Object.assign(ctx, patch);
}

/** Read the active request context, or `null` if no scope is open. */
export function getRequestContext(): RequestContext | null {
  return storage().getStore() ?? null;
}

/** Convenience reader. Returns the request_id from the active scope, or `null`. */
export function getRequestId(): string | null {
  return storage().getStore()?.requestId ?? null;
}

/** Convenience reader. Returns the active actor kind, or `null`. */
export function getActorKind(): string | null {
  return storage().getStore()?.actorKind ?? null;
}

/** Convenience reader. Returns the active actor id, or `null`. */
export function getActorId(): string | null {
  return storage().getStore()?.actorId ?? null;
}

/** Convenience reader. Returns the active caller_app, or `null`. */
export function getCallerApp(): string | null {
  return storage().getStore()?.callerApp ?? null;
}
