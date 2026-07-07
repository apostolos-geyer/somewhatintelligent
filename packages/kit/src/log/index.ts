/**
 * Canonical log barrel — re-exports the core primitive (`./core`) plus the
 * boundary wrappers (`./http`, `./instrumented`, `./scheduled`).
 *
 * Sub-modules import from `./core` rather than `./index` to keep this barrel
 * acyclic. Read `./core` for the architectural overview.
 */
export {
  type CanonicalLogBuilder,
  type CanonicalLogContext,
  describeThrown,
  getRequestLog,
  type Level,
  requireRequestLog,
  withCanonicalLog,
} from "./core";
export { withRequestLog } from "./http";
export type { RequestLogConfig } from "./http";
export { instrumented, logged } from "./instrumented";
export type { InstrumentationConfig } from "./instrumented";
export { loggedJob } from "./scheduled";
export type { JobLogConfig } from "./scheduled";
