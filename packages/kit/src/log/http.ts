/**
 * HTTP-edge wrapper. Use inside framework-specific request middleware
 * (TanStack Start `createMiddleware({type: "request"})`, Elysia `onRequest`/
 * `onAfterHandle`, raw `fetch()` handlers) to emit one `event: "http"` line
 * per inbound request — captures method/path automatically, lets the
 * middleware add status/userId/etc via the builder.
 *
 * The default operation name is `"http.<method-lowercased>"`; pass
 * `deriveOperation` to use route-derived ops like `"roadie.api.upload"`
 * when the framework knows the matched route.
 *
 * Usage (TanStack Start middleware):
 *
 *   const middleware = createMiddleware({ type: "request" }).server(
 *     async ({ next, request }) =>
 *       withRequestLog(
 *         {
 *           service: "roadie",
 *           resolveContext: (req) => ({
 *             requestId: req.headers.get("cf-request-id") ?? ulid(),
 *             actorKind: "anonymous",
 *             actorId: null,
 *           }),
 *         },
 *         request,
 *         async (log) => {
 *           const result = await next();
 *           log.add({ status: result.response.status });
 *           if (result.response.status >= 500) log.outcome("internal_error");
 *           else if (result.response.status >= 400) log.outcome(`http_${result.response.status}`);
 *           return result;
 *         },
 *       ),
 *   );
 */
import { type CanonicalLogBuilder, type CanonicalLogContext, withCanonicalLog } from "./core";

type PartialContext = Omit<CanonicalLogContext, "service" | "event" | "operation">;

export interface RequestLogConfig {
  service: string;
  /**
   * Optional. Provide explicit ctx fields when not relying on the
   * request-context ALS. When omitted, `withCanonicalLog` reads
   * requestId/actorKind/actorId/callerApp from ALS at emit time.
   */
  resolveContext?: (req: Request) => Promise<PartialContext> | PartialContext;
  /** Override op name. Default: `"http.<method-lowercased>"`. */
  deriveOperation?: (req: Request) => string;
}

export async function withRequestLog<T>(
  config: RequestLogConfig,
  req: Request,
  fn: (log: CanonicalLogBuilder) => Promise<T>,
): Promise<T> {
  const partial = (await config.resolveContext?.(req)) ?? {};
  const operation = config.deriveOperation?.(req) ?? `http.${req.method.toLowerCase()}`;
  return withCanonicalLog(
    {
      ...partial,
      service: config.service,
      event: "http",
      operation,
    },
    async (log) => {
      const url = new URL(req.url);
      log.add({ method: req.method, path: url.pathname });
      return fn(log);
    },
  );
}
