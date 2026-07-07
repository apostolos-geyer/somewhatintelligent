/**
 * Class-level instrumentation for RPC service classes.
 *
 * Walks the class prototype at install time and wraps every async method
 * with a `withCanonicalLog` scope. Method bodies stay as plain method
 * definitions (required for Cloudflare Workers RPC dispatch — arrow-fn
 * class fields aren't on the prototype, so CF can't see them as RPC methods).
 * Domain fields are accrued in handler bodies via `requireRequestLog().add()`.
 *
 * `@instrumented({...})` — TC39 Stage 3 class decorator. Use when the
 * bundler transforms decorator syntax (vite-plus apps, CF Agents apps).
 *
 * Usage:
 *
 *   @instrumented({
 *     service: "roadie",
 *     resolveContext: ({ methodName, args, instance }) => {
 *       const meta = args[1] as CallMeta;
 *       return {
 *         requestId: meta.requestId,
 *         actorKind: meta.actor.kind,
 *         actorId: actorIdFor(meta.actor),
 *         callerApp: readCallerApp(instance, meta),
 *       };
 *     },
 *     deriveOutcome: (ret) => ret.ok ? "ok" : ret.error,
 *     onError: (e) => err("internal_error", String(e)),
 *   })
 *   export class Roadie extends WorkerEntrypoint<RoadieEnv> {
 *     async signPart(input, meta) {
 *       requireRequestLog().add({ reference_id: input.referenceId });
 *       return ok(presigned);
 *     }
 *
 *     @logged.skip
 *     async healthCheck() { return ok({ status: "healthy" }); }
 *   }
 */
import { type CanonicalLogContext, describeThrown, withCanonicalLog } from "./core";

export interface InstrumentationConfig {
  /** Service name for emitted lines — `"roadie"`, `"guestlist"`, `"promoter"`. */
  service: string;
  /**
   * Resolve per-call canonical log context from method args/instance.
   * Returns context fields excluding `service`/`event`/`operation` (filled
   * by the wrapper). May override `operation` to use a non-default name.
   */
  resolveContext: (args: { methodName: string; args: unknown[]; instance: unknown }) => Omit<
    CanonicalLogContext,
    "service" | "event" | "operation"
  > & {
    operation?: string;
  };
  /**
   * Inspect a method's normal return value to derive outcome. Useful for
   * `Result<T, E>`-discriminant inference. Called only on normal return;
   * thrown errors set outcome to `"internal_error"` automatically. Return
   * `undefined` to keep the default `"ok"` outcome.
   */
  deriveOutcome?: (returnValue: unknown) => string | undefined;
  /**
   * Convert a thrown error into a return value. Used by services with
   * Result-typed APIs (like Roadie) that document "methods never throw —
   * always return Result<T, E>". When set, exceptions are caught, the
   * line emits with `outcome: "internal_error"` + `error_message`, and
   * the handler's return value is returned to the caller in place of
   * rethrowing. When unset (default), exceptions propagate per kit's
   * primitive behavior.
   */
  onError?: (e: unknown) => unknown;
}

const SKIPPED = new WeakSet<object>();

/**
 * Method-level decorator. Mark a method to be excluded from class-level
 * `@instrumented` wrapping — useful for health checks, internal helpers,
 * or methods that emit their own log lines via `withCanonicalLog` directly.
 */
export const logged = {
  skip<This, Args extends unknown[], Return>(
    target: (this: This, ...args: Args) => Return,
    _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
  ): (this: This, ...args: Args) => Return {
    SKIPPED.add(target as object);
    return target;
  },
};

// biome-ignore lint/suspicious/noExplicitAny: class decorators need broad constructor signatures
type Constructor = abstract new (...args: any[]) => object;

function makeWrapped(
  name: string,
  original: (...args: unknown[]) => unknown,
  config: InstrumentationConfig,
) {
  return async function wrapped(this: unknown, ...args: unknown[]) {
    let partial: ReturnType<InstrumentationConfig["resolveContext"]>;
    try {
      partial = config.resolveContext({ methodName: name, args, instance: this });
    } catch (e) {
      // `resolveContext` runs BEFORE the main scope opens and can throw — e.g. a
      // misconfigured RPC binding whose `caller_app` can't be resolved. Without
      // this guard that throw escapes with NO canonical line AND bypasses
      // `onError`, so the runtime records `outcome:"exception"` with empty
      // `logs`/`exceptions`: a fatal, every-request misconfiguration that is
      // completely invisible in the tail — the single worst observability hole.
      // Open a minimal scope (correlation fields still resolve from ALS at emit
      // time) so the failure ALWAYS emits an actionable line, then honor
      // `onError`/rethrow exactly like the body path below.
      const { message, stack } = describeThrown(e);
      return withCanonicalLog(
        { service: config.service, event: "rpc", operation: `${config.service}.${name}` },
        async (log) => {
          log.outcome("internal_error");
          log.add({ error_message: message, error_stack: stack ?? message, error_phase: "resolve_context" });
          if (!config.onError) throw e;
          return config.onError(e);
        },
      );
    }
    const operation = partial.operation ?? `${config.service}.${name}`;
    return withCanonicalLog(
      {
        service: config.service,
        event: "rpc",
        operation,
        requestId: partial.requestId,
        actorKind: partial.actorKind,
        actorId: partial.actorId,
        callerApp: partial.callerApp,
        errorOutcomes: partial.errorOutcomes,
        forbiddenFields: partial.forbiddenFields,
        forbiddenPrefixes: partial.forbiddenPrefixes,
      },
      async (log) => {
        let result: unknown;
        try {
          result = await (original as (...a: unknown[]) => Promise<unknown>).apply(this, args);
        } catch (e) {
          if (!config.onError) throw e;
          const { message } = describeThrown(e);
          log.outcome("internal_error");
          log.add({ error_message: message });
          return config.onError(e);
        }
        if (config.deriveOutcome) {
          const outcome = config.deriveOutcome(result);
          if (outcome !== undefined) log.outcome(outcome);
        }
        return result;
      },
    );
  };
}

function applyInstrumentation<T extends Constructor>(
  target: T,
  config: InstrumentationConfig,
  skip?: ReadonlySet<string>,
): T {
  const proto = target.prototype as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor") continue;
    if (skip?.has(name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor || typeof descriptor.value !== "function") continue;
    const original = descriptor.value as (...args: unknown[]) => unknown;
    if (SKIPPED.has(original as object)) continue;
    Object.defineProperty(proto, name, {
      ...descriptor,
      value: makeWrapped(name, original, config),
    });
  }
  return target;
}

export function instrumented(config: InstrumentationConfig) {
  return function decorate<T extends Constructor>(
    target: T,
    _context: ClassDecoratorContext<T>,
  ): T {
    return applyInstrumentation(target, config);
  };
}
