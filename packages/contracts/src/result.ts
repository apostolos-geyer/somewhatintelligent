/**
 * The shared domain-result envelope. Every RPC method and HTTP handler in the
 * control plane returns a `DomainResult` so success and typed domain errors are
 * distinguishable without exceptions. Transcribed from RFC-0001 "Shared
 * operator call contract".
 */
export type DomainResult<T, E extends string> =
  | { ok: true; value: T }
  | { ok: false; error: E; message?: string };

/** Construct a successful result. */
export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

/** Construct a failed result with a typed error code and optional message. */
export function err<E extends string>(
  error: E,
  message?: string,
): { ok: false; error: E; message?: string } {
  return message === undefined ? { ok: false, error } : { ok: false, error, message };
}
