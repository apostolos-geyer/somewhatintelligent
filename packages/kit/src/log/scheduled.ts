/**
 * Scheduled-job wrapper. Use to wrap Worker `scheduled()` handlers and
 * any background task that runs outside an inbound request — synthesizes
 * a `requestId` (crypto.randomUUID by default; pass `generateRequestId`
 * to use a ulid factory or your platform's tracing ID), sets
 * `actor: { kind: "service", id: service }`, and emits the canonical
 * line as `event: "job"`.
 *
 * Usage:
 *
 *   import { loggedJob, requireRequestLog } from "@si/kit/log";
 *   import { ulid } from "@si/kit/ids";
 *
 *   const reapExpiredGrants = loggedJob(
 *     {
 *       service: "roadie",
 *       operation: "roadie.job.reap_expired_grants",
 *       generateRequestId: () => ulid(),
 *     },
 *     async (env: Env, ctx: ExecutionContext) => {
 *       const reaped = await sweepGrants(env);
 *       requireRequestLog().add({ reaped_count: reaped.length });
 *     },
 *   );
 *
 *   export default {
 *     async scheduled(_controller, env, ctx) {
 *       await reapExpiredGrants(env, ctx);
 *     },
 *   };
 */
import { withRequestContext } from "../request-context";
import { type CanonicalLogContext, withCanonicalLog } from "./core";

type ExtraContext = Partial<
  Omit<
    CanonicalLogContext,
    "service" | "event" | "operation" | "requestId" | "actorKind" | "actorId"
  >
>;

export interface JobLogConfig {
  service: string;
  operation: string;
  /** Synthesize a requestId for this job run. Default: `crypto.randomUUID()`. */
  generateRequestId?: () => string;
  /** Optional extra context fields (callerApp, custom forbiddenFields, etc). */
  resolveContext?: () => Promise<ExtraContext> | ExtraContext;
}

// Opens both the canonical-log scope (for the `event: "job"` line) and the
// request-context ALS scope so the handler — and anything it calls — can
// read the synthesized requestId via `getRequestId()` without closure
// tricks. Matches the pattern app fetch handlers use.
export function loggedJob<Args extends unknown[], Return>(
  config: JobLogConfig,
  handler: (...args: Args) => Promise<Return>,
): (...args: Args) => Promise<Return> {
  return async (...args) => {
    const requestId = config.generateRequestId?.() ?? crypto.randomUUID();
    const extra = (await config.resolveContext?.()) ?? {};
    return withRequestContext(
      {
        requestId,
        actorKind: "service",
        actorId: config.service,
        callerApp: extra.callerApp,
      },
      () =>
        withCanonicalLog(
          {
            ...extra,
            service: config.service,
            event: "job",
            operation: config.operation,
            requestId,
            actorKind: "service",
            actorId: config.service,
          },
          async () => handler(...args),
        ),
    );
  };
}
