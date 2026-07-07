import { executionContext } from "@si/kit/execution-context";

export { executionContext };

/**
 * Elysia's CloudflareAdapter doesn't forward the CF runtime's
 * ExecutionContext (its fetch signature is (request) only). We seed the
 * shared @si/kit/execution-context ALS at the runtime boundary so
 * downstream code (Better Auth's backgroundTasks.handler, any waitUntil
 * need) can read it back with `executionContext.getStore()`.
 */
export function withExecutionContext<T extends { fetch: (req: Request) => unknown }>(
  app: T,
): ExportedHandler {
  return {
    async fetch(request: Request, _env: unknown, ctx: ExecutionContext) {
      return executionContext.run(ctx, () => app.fetch(request)) as Promise<Response>;
    },
  };
}
