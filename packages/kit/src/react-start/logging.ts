/**
 * Global server-fn function-middleware that PATCHES the active request log
 * scope (opened by `createRequestLogger`) with `event: "server_fn"` and an
 * `operation` derived from the compile-time `serverFnMeta.name`. Does NOT
 * open its own canonical-log scope — server-fns run inside an HTTP request
 * that already has one open via the request middleware, and opening a
 * nested scope would double-emit (one server_fn line + one http line per
 * server-fn invocation).
 *
 * Override mechanic: `withCanonicalLog` emits with `{...ctx, ...fields}` —
 * `...fields` spread last, so `log.add({ event, operation })` overrides
 * the request middleware's `event: "http"` / `operation: "http.<method>"`
 * defaults for this one line. The HTTP-specific fields (`method`, `path`,
 * `status`) the request middleware added still ride along, so a server-fn
 * line carries both function-level identity (event/operation) and
 * transport metadata.
 *
 * Wire once in `start.ts`:
 *
 *   // workers/<app>/src/start.ts
 *   import { createStart } from "@tanstack/react-start";
 *   import {
 *     createLoggingFunctionMiddleware,
 *     createRequestLogger,
 *   } from "@greenroom/kit/react-start";
 *
 *   const requestLogger = createRequestLogger({ service: "<app>" });
 *   const functionLogger = createLoggingFunctionMiddleware({ service: "<app>" });
 *
 *   export const startInstance = createStart(() => ({
 *     requestMiddleware: [requestLogger],
 *     functionMiddleware: [functionLogger],
 *   }));
 */
import { createMiddleware } from "@tanstack/react-start";
import { describeThrown, getRequestLog } from "../log";

export function createLoggingFunctionMiddleware(opts: { service: string }) {
  return createMiddleware({ type: "function" }).server(async ({ next, serverFnMeta }) => {
    const log = getRequestLog();
    if (log) {
      log.add({
        event: "server_fn",
        operation: `${opts.service}.${serverFnMeta.name}`,
      });
    }
    // A server-fn throw is masked into a 500 by the framework before it reaches
    // the fetch-boundary logger, so record the failure (with a traceback) onto
    // the active request line here, then rethrow so behaviour is unchanged.
    try {
      return await next();
    } catch (err) {
      if (log) {
        if (err instanceof Response) {
          // TanStack `redirect()` (and any deliberate `throw new Response`)
          // is control flow, not a failure: mirror the request logger's
          // status→outcome mapping and never fabricate error fields from it.
          if (err.status >= 500) log.outcome("internal_error");
          else if (err.status >= 400) log.outcome(`http_${err.status}`);
          else log.outcome("redirect");
        } else {
          const { message, stack } = describeThrown(err);
          log.add({ error_message: message, error_stack: stack ?? message });
          log.outcome("internal_error");
        }
      }
      throw err;
    }
  });
}
