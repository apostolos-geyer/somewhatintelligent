/**
 * Monotonic ULID factory + entity-prefixed IDs.
 *
 * On Cloudflare Workers, `Date.now()` is pinned at the start of a request and
 * does not advance until the next I/O. Multiple ULIDs minted in the same sync
 * block therefore share a timestamp; without a monotonic factory, each draws
 * an independent random suffix and lex ordering is no longer guaranteed.
 * `ulidx`'s own docs flag plain `ulid()` as unsafe in this runtime — the
 * factory must be a per-isolate singleton, declared once at module scope.
 */
import { monotonicFactory, decodeTime as ulidDecodeTime, isValid as ulidIsValid } from "ulidx";

const monotonic = monotonicFactory();

/** Mint a monotonic ULID (26 chars, Crockford base32). Module-singleton factory. */
export function ulid(): string {
  return monotonic();
}

const PREFIX_RE = /^[a-z][a-z0-9]{0,9}$/;

/**
 * Mint a prefixed ID of the form `<prefix>-<monotonic-ulid>`.
 * Prefix must be lowercase alphanumeric, start with a letter, ≤10 chars.
 *
 * Example: `id("grant")` → `"grant-01HZX5F7ABCDEF123456GHJKMN"`.
 */
export function id(prefix: string): string {
  if (!PREFIX_RE.test(prefix)) {
    throw new Error(
      `Invalid id prefix: ${prefix}. Must be lowercase alphanumeric, start with a letter, ≤10 chars.`,
    );
  }
  return `${prefix}-${monotonic()}`;
}

/** Decode the timestamp (ms) embedded in a plain or prefixed ULID. */
export function decodeTime(value: string): number {
  const idx = value.indexOf("-");
  const body = idx === -1 ? value : value.slice(idx + 1);
  return ulidDecodeTime(body);
}

/**
 * Validate that `value` is a (possibly prefixed) ULID.
 * Pass `expectedPrefix` to assert a specific entity prefix.
 */
export function isValid(value: string, expectedPrefix?: string): boolean {
  const idx = value.indexOf("-");
  if (expectedPrefix !== undefined) {
    if (idx === -1) return false;
    if (value.slice(0, idx) !== expectedPrefix) return false;
    return ulidIsValid(value.slice(idx + 1));
  }
  if (idx === -1) return ulidIsValid(value);
  return ulidIsValid(value.slice(idx + 1));
}

/** Escape hatch — the underlying monotonic factory, for callers that need raw access. */
export { monotonic };
