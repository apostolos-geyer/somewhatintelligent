/**
 * Opaque keyset cursor for the public list endpoints. A cursor names the last
 * row of the previous page as `(ts, id)` — the sort timestamp (a release's
 * `published_at` or a publication's `updated_at`) plus the tiebreak id — so the
 * next page is a stable keyset seek rather than a fragile numeric OFFSET.
 * `decodeCursor` returns `null` for anything it cannot parse into that shape;
 * callers surface that as the `invalid_cursor` domain error.
 */

export interface KeysetCursor {
  ts: number;
  id: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Clamp a caller-supplied page size into `[1, MAX_LIMIT]`, defaulting when absent. */
export function clampLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/** Encode a keyset position as a URL-safe base64 token. */
export function encodeCursor(cursor: KeysetCursor): string {
  return btoa(JSON.stringify([cursor.ts, cursor.id]))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Decode a cursor token, returning `null` for any malformed input. */
export function decodeCursor(raw: string): KeysetCursor | null {
  try {
    const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const parsed: unknown = JSON.parse(atob(b64));
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [ts, id] = parsed;
    if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
    if (typeof id !== "string" || id.length === 0) return null;
    return { ts, id };
  } catch {
    return null;
  }
}
