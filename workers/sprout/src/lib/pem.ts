/**
 * PURE PEM helpers — no env, trivially unit-testable.
 *
 * `.dev.vars` (and many secret stores) carry a private key on a single line with
 * escaped newlines (`\n` as two characters), because the dotenv-style format is
 * line-oriented. `importPKCS8` (jose) needs a real multi-line PEM, so a raw value
 * with literal `\n` fails with "Invalid PKCS8 input" — which silently degrades the
 * dev-envelope stamper (and with it the Durable-Object / WebSocket auth path).
 *
 * `normalizePrivPem` converts those escaped newlines back to real ones. It is a
 * no-op for a value that already has real newlines, so it is safe to apply
 * unconditionally before handing a key to `importPKCS8`.
 */
export function normalizePrivPem(raw: string | undefined | null): string {
  if (!raw) return "";
  return raw.replace(/\\n/g, "\n");
}
