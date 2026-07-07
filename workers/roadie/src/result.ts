// Result envelope for RPC methods. Workers RPC error propagation is lossy —
// only name/message cross the boundary, custom properties and stack traces
// are stripped, and AggregateError is not forwarded. A discriminated result
// preserves typed error codes the consumer can switch on exhaustively.
// See RFC ADR-RD-010.
export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message?: string };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E extends string>(
  error: E,
  message?: string,
): { ok: false; error: E; message?: string } {
  return message === undefined ? { ok: false, error } : { ok: false, error, message };
}
