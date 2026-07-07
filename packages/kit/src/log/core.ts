/**
 * Canonical log line — one structured JSON line per logical operation.
 *
 * The platform's single log shape, used at every boundary: HTTP edges,
 * service-binding RPC methods, TanStack server-fns, scheduled jobs, and
 * Better Auth events. Every line carries `{service, event, operation,
 * outcome, duration_ms, request_id, caller_app, actor_kind, actor_id,
 * time}` plus per-op domain fields. `request_id` is NEVER minted here —
 * it always comes from the caller (`cf-request-id` adopted at the entry
 * Worker, propagated unchanged through every layer).
 *
 * Field accrual is propagated via `AsyncLocalStorage` — handlers anywhere
 * in the async call stack call `getRequestLog()` (or `requireRequestLog()`)
 * to add domain fields without explicit parameter threading. This is what
 * makes boundary instrumentation work: framework-level wrappers open the
 * scope, handler code is plain.
 *
 * Logging is intentionally decoupled from `Result<T, E>` envelopes.
 * Outcome is set explicitly via `log.outcome(code)`; the primitive
 * defaults to `"ok"` on normal return and `"internal_error"` on throw.
 * Callers that use Result envelopes wrap this primitive in their own
 * thin adapter that derives outcome from the result discriminant.
 *
 * Sub-modules (`./http`, `./instrumented`, `./scheduled`, `./server-fn`)
 * import the primitives from this file rather than `./index` so the barrel
 * stays acyclic.
 */
/// <reference types="node" />
// Namespace import — see kit/request-context for the same rationale. Vite
// externalizes `node:async_hooks` in the client environment to a Proxy
// that throws on any property access. A named `{ AsyncLocalStorage }`
// destructure becomes a module-init `stub["AsyncLocalStorage"]` access in
// Vite's dev transform and crashes the browser. The namespace binding is
// inert until `logStorage()` is invoked server-side.
import * as nodeAsyncHooks from "node:async_hooks";
import type { AsyncLocalStorage as ALS } from "node:async_hooks";
import { getActorId, getActorKind, getCallerApp, getRequestId } from "../request-context";

export type Level = "info" | "warn" | "error";

export interface CanonicalLogBuilder {
  /** Merge fields into the line. Last write wins. Forbidden keys are stripped at emit time. */
  add(fields: Record<string, unknown>): void;
  /** Set the outcome code. Defaults to `"ok"` on normal return. Overridden to `"internal_error"` on throw. */
  outcome(code: string): void;
}

export interface CanonicalLogContext {
  /** Component emitting the line — `"roadie"`, `"guestlist"`, `"identity"`, etc. */
  service: string;
  /** Event kind — `"rpc" | "http" | "server_fn" | "job" | "auth"`. Free-form to allow new categories. */
  event: string;
  /** Abstract operation name — `"roadie.signPart"`, `"identity.server_fn.submit_attempt"`. */
  operation: string;
  /**
   * Request ID. Optional — when omitted, read from the active
   * `withRequestContext` ALS scope at emit time. Pass explicitly only
   * when no ALS scope is open (e.g. RPC paths where `meta.requestId` is
   * authoritative).
   */
  requestId?: string;
  /** Actor identity kind. Optional — read from ALS at emit time when omitted. */
  actorKind?: string;
  /** Actor identifier. Optional — read from ALS at emit time when omitted. */
  actorId?: string | null;
  /** For RPC events: which app/service called this method. Optional — read from ALS at emit time when omitted. */
  callerApp?: string;
  /** Outcome codes that should emit at error level. Defaults: `{"backend_unavailable", "internal_error"}`. */
  errorOutcomes?: ReadonlySet<string>;
  /** Field names that must never be emitted. Defaults to a security-baseline set. */
  forbiddenFields?: ReadonlySet<string>;
  /** Field-name prefixes whose matches must never be emitted. Defaults: `["R2_", "S3_"]`. */
  forbiddenPrefixes?: readonly string[];
}

const DEFAULT_ERROR_OUTCOMES: ReadonlySet<string> = new Set([
  "backend_unavailable",
  "internal_error",
]);

const DEFAULT_FORBIDDEN_FIELDS: ReadonlySet<string> = new Set([
  "url",
  "uploadUrl",
  "body",
  "requiredHeaders",
  "permissionScope",
  "password",
  "secret",
  "authorization",
  "cookie",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
]);

const DEFAULT_FORBIDDEN_PREFIXES: readonly string[] = ["R2_", "S3_"];

let _logStorage: ALS<CanonicalLogBuilder> | undefined;
function logStorage(): ALS<CanonicalLogBuilder> {
  return (_logStorage ??= new nodeAsyncHooks.AsyncLocalStorage<CanonicalLogBuilder>());
}

/**
 * Read the current canonical log builder from the surrounding async context.
 * Returns `null` if no `withCanonicalLog` scope is active. Use inside handlers
 * to accrue domain fields from anywhere in the call stack.
 */
export function getRequestLog(): CanonicalLogBuilder | null {
  return logStorage().getStore() ?? null;
}

/**
 * Like `getRequestLog()` but throws if no scope is active. Use when the
 * call site must be inside a logged boundary (server-fn handler, RPC
 * method, instrumented job) — failing loudly beats silently dropping
 * domain fields.
 */
export function requireRequestLog(): CanonicalLogBuilder {
  const log = logStorage().getStore();
  if (!log) {
    throw new Error(
      "requireRequestLog() called outside any withCanonicalLog scope — " +
        "this code path is not running inside an instrumented boundary",
    );
  }
  return log;
}

// Removes forbidden fields (per the security baseline) AND `undefined`
// values. `undefined` would JSON-stringify away in production but pollutes
// `console.log(line)` output during dev (e.g. `caller_app: undefined` on a
// leaf service's own events). `null` is preserved — it's a meaningful
// signal (`actor_id: null` for anonymous, etc.).
function stripLine(
  line: Record<string, unknown>,
  fields: ReadonlySet<string>,
  prefixes: readonly string[],
): Record<string, unknown> {
  for (const key of Object.keys(line)) {
    if (line[key] === undefined || fields.has(key) || prefixes.some((p) => key.startsWith(p))) {
      delete line[key];
    }
  }
  return line;
}

/**
 * Serialize a thrown value into log-safe `message`/`stack` strings.
 * `String(x)` on a non-Error object yields `[object Object]` /
 * `[object Response]` — useless in a canonical line. Thrown `Response`s
 * (TanStack `redirect()` et al) are named by status; other non-Error
 * objects are JSON-encoded (truncated) so the line stays actionable.
 */
export function describeThrown(e: unknown): { message: string; stack?: string } {
  if (e instanceof Error) return { message: e.message, stack: e.stack };
  if (e instanceof Response) return { message: `thrown Response (status ${e.status})` };
  if (typeof e === "object" && e !== null) {
    try {
      return { message: JSON.stringify(e).slice(0, 500) };
    } catch {
      return { message: "[unserializable object]" };
    }
  }
  return { message: String(e) };
}

export async function withCanonicalLog<T>(
  ctx: CanonicalLogContext,
  fn: (log: CanonicalLogBuilder) => Promise<T>,
): Promise<T> {
  const errorOutcomes = ctx.errorOutcomes ?? DEFAULT_ERROR_OUTCOMES;
  const forbiddenFields = ctx.forbiddenFields ?? DEFAULT_FORBIDDEN_FIELDS;
  const forbiddenPrefixes = ctx.forbiddenPrefixes ?? DEFAULT_FORBIDDEN_PREFIXES;

  const start = Date.now();
  const fields: Record<string, unknown> = {};
  let outcome = "ok";

  const builder: CanonicalLogBuilder = {
    add(extra) {
      Object.assign(fields, extra);
    },
    outcome(code) {
      outcome = code;
    },
  };

  const emit = (finalOutcome: string, level: Level) => {
    // Read correlation fields at EMIT time, not scope-open time. This lets
    // boundary middleware open a scope with just `{ requestId }` early, then
    // patch in actor/caller info as handlers resolve them. By the time emit
    // runs (handler done, scope closing), the ALS reflects the final state.
    // Explicit ctx values still win — RPC paths pass meta.requestId directly.
    const line = stripLine(
      {
        service: ctx.service,
        event: ctx.event,
        operation: ctx.operation,
        outcome: finalOutcome,
        request_id: ctx.requestId ?? getRequestId() ?? undefined,
        caller_app: ctx.callerApp ?? getCallerApp() ?? undefined,
        actor_kind: ctx.actorKind ?? getActorKind() ?? undefined,
        actor_id: ctx.actorId ?? getActorId() ?? null,
        duration_ms: Date.now() - start,
        time: new Date().toISOString(),
        ...fields,
      },
      forbiddenFields,
      forbiddenPrefixes,
    );
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };

  return logStorage().run(builder, async () => {
    try {
      const result = await fn(builder);
      emit(outcome, errorOutcomes.has(outcome) ? "error" : "info");
      return result;
    } catch (e) {
      // Always attach a traceback so an internal_error line is actionable — a
      // canonical line that says "something threw" with no stack is the gap we
      // are closing. Falls back to the serialized value for non-Error throws.
      const { message, stack } = describeThrown(e);
      builder.add({ error_message: message, error_stack: stack ?? message });
      emit("internal_error", "error");
      throw e;
    }
  });
}
