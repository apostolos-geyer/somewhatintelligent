// Workaround for @cloudflare/vitest-pool-workers Function proxy bug.
//
// The test runner patches globalThis.Function with a Proxy that only intercepts
// `construct` (new Function). Elysia's AOT compiler calls Function() without
// `new`, bypassing the Proxy. This shim adds the missing `apply` trap by
// wrapping the existing Proxy and routing bare calls through `Reflect.construct`.
//
// Bug: workers-sdk packages/vitest-pool-workers/src/worker/index.ts:146-152
//      The Proxy needs an `apply` trap identical to its `construct` trap.
// Upstream fix: https://github.com/cloudflare/workers-sdk — pending PR
const F = globalThis.Function;
globalThis.Function = new Proxy(F, {
  construct: (target, args, newTarget) => Reflect.construct(target, args, newTarget),
  apply: (_target, _thisArg, args) => Reflect.construct(F, args),
});
