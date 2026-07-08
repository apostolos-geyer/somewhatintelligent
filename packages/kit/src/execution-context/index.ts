import { AsyncLocalStorage } from "node:async_hooks";

/** Minimal structural view of Cloudflare's ExecutionContext — avoids a
 *  @cloudflare/workers-types dependency in @si/kit. The real
 *  ExecutionContext (worker-configuration.d.ts in each worker) is
 *  structurally assignable to this. */
export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}

export const executionContext = new AsyncLocalStorage<WaitUntilContext>();

export const runWithExecutionContext = <T>(
  ctx: WaitUntilContext,
  fn: () => Promise<T>,
): Promise<T> => executionContext.run(ctx, fn);
