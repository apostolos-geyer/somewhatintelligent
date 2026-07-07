// Server-side-only factories. The marker lives on the leaf modules with
// eager top-level side effects (`../log/core.ts`, `../request-context/index.ts`)
// so legitimate isomorphic config files (e.g. `workers/*/src/start.ts`, which
// TSS imports from both sides) can still pull factory references without
// firing import-protection on the barrel itself. The factories themselves
// return middleware definition objects whose `.server()` callbacks fire
// only server-side; the closures inside capture mock proxies in the client
// bundle but never invoke them.
export { createEnvelopeMiddleware, createPrincipalGate } from "./envelope-middleware";
export type { Principal, EnvelopeMiddlewareOpts, PrincipalGateOpts } from "./envelope-middleware";
export { createLoggingFunctionMiddleware } from "./logging";
export { createRequestLogger } from "./request-logger";
export { extractPlatformStartContext } from "./platform-start-context";
export type { PlatformStartContext } from "./platform-start-context";
export {
  createGuestlistFactory,
  createRoadieFactory,
  createSessionFactory,
} from "./service-clients";
export { createPlatformStartApp } from "./platform-start-app";
export type { PlatformStartAppOpts } from "./platform-start-app";
export { createDevEnvelopeStamper } from "./dev-envelope";
export type {
  DevEnvelopeStamper,
  DevEnvelopeStamperOpts,
  DevEnvelopeStampOutcome,
  GuestlistClientShape as DevEnvelopeGuestlistShape,
  StampableSession as DevEnvelopeStampableSession,
} from "./dev-envelope";
