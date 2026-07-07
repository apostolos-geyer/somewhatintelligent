/**
 * Client-safe subset of `@greenroom/kit/react-start`.
 *
 * Importing from `@greenroom/kit/react-start` (the server barrel) drags in
 * modules that top-level-instantiate `AsyncLocalStorage` from
 * `node:async_hooks`, which Vite externalizes for the browser. Client code
 * imports from this entry instead. Only TSS bindings that are safe to evaluate
 * in the browser belong here.
 */
export { createReactStartAuthProvider } from "./auth-provider";
export type { ReactStartAuthProviderOpts } from "./auth-provider";
