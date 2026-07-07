// Re-export of Roadie's Result envelope for client consumers. The wire
// shape is owned by the service (../result.ts); the client surface re-exports
// so consumers import via `@si/roadie-service/client` without reaching
// into Roadie internals.
export { ok, err, type Result } from "../result";
