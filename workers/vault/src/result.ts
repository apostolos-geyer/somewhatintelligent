// Result envelope for RPC methods. Workers RPC error propagation is lossy —
// only name/message cross the boundary, custom properties and stack traces
// are stripped, and AggregateError is not forwarded. A discriminated result
// preserves typed error codes the consumer can switch on exhaustively.
// (Same shape as roadie's result.ts, plus an optional `labels` detail so
// grant_missing / grant_ambiguous can name the labels machine-readably per
// the PRD error contract.)
export type Result<T, E extends string = string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message?: string; labels?: readonly string[] };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function err<E extends string>(
  error: E,
  message?: string,
  labels?: readonly string[],
): { ok: false; error: E; message?: string; labels?: readonly string[] } {
  return {
    ok: false,
    error,
    ...(message !== undefined && { message }),
    ...(labels !== undefined && { labels }),
  };
}
