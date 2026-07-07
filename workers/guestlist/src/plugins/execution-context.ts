/**
 * Elysia's CloudflareAdapter doesn't forward the CF runtime's ExecutionContext
 * (its fetch signature is (request) only — see node_modules/elysia/dist/adapter/
 * cloudflare-worker/index.mjs). We seed an AsyncLocalStorage at the runtime
 * boundary via `withExecutionContext` so downstream code (Better Auth's
 * backgroundTasks.handler, any future plugin needing waitUntil) can read it
 * back with `executionContext.getStore()`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export const executionContext = new AsyncLocalStorage<ExecutionContext>();

export function withExecutionContext<T extends { fetch: (req: Request) => unknown }>(
  app: T,
): ExportedHandler {
  return {
    async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
      return executionContext.run(ctx, () => app.fetch(request)) as Promise<Response>;
    },
  };
}
