/**
 * Global request-middleware that opens the per-request canonical scope:
 *
 *   - Seeds the request-context ALS from TSS's typed `requestContext`
 *     (apps' `worker.ts` populates it at the universal-fetch boundary
 *     by passing `{ context: { requestId, callerApp } }` to
 *     `startEntry.fetch`).
 *   - Opens a canonical `event: "http"` log scope; sets `outcome` from the
 *     final response status; emits one line per inbound request.
 *
 * Wire once in `start.ts`:
 *
 *   // workers/<app>/src/start.ts
 *   import { createStart } from "@tanstack/react-start";
 *   import { createRequestLogger } from "@si/kit/react-start";
 *
 *   const requestLogger = createRequestLogger({ service: "<app>" });
 *
 *   export const startInstance = createStart(() => ({
 *     requestMiddleware: [requestLogger],
 *   }));
 *
 * Static imports of kit/log + kit/request-context are fine — node:async_hooks
 * is externalized by vite for the client bundle and the .server() body is
 * stripped by TSS's import-protection plugin anyway.
 */
import { createMiddleware } from "@tanstack/react-start";
import { withRequestLog } from "../log";
import { withRequestContext } from "../request-context";

/**
 * Contract: consuming apps must augment `@tanstack/react-start`'s `Register`
 * with `server: { requestContext: { requestId: string; callerApp?: string } }`
 * (typically in `worker.ts`) AND seed those fields at the universal-fetch
 * boundary. `callerApp` is intentionally optional: it carries the upstream
 * caller's identity (read from the `x-caller-app` header) and is omitted
 * from logs when the request didn't come from another in-platform worker.
 * The kit factory compiles independently of those augmentations, so it
 * casts `context` to this shape rather than relying on inferred types.
 */
interface RequestContextShape {
  requestId: string;
  callerApp?: string;
}

export function createRequestLogger(opts: { service: string }) {
  return createMiddleware({ type: "request" }).server(async ({ context, next, request }) => {
    const ctx = context as unknown as RequestContextShape;
    return withRequestContext({ requestId: ctx.requestId, callerApp: ctx.callerApp }, () =>
      withRequestLog({ service: opts.service }, request, async (log) => {
        const result = await next();
        const status = result.response.status;
        log.add({ status });
        if (status >= 500) log.outcome("internal_error");
        else if (status >= 400) log.outcome(`http_${status}`);
        return result;
      }),
    );
  });
}
