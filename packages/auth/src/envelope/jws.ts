/**
 * Tiny JWS-compact + base64url helpers + PEM → CryptoKey importers.
 *
 * Used by `mint.ts` and `verify.ts` for the Ed25519 bouncer attestation
 * envelope. No external dependency — pure WebCrypto.
 */

/** base64url-encode binary or string. */
export function b64uEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url-decode to bytes. */
export function b64uDecodeBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** base64url-decode to a UTF-8 string. */
export function b64uDecodeString(input: string): string {
  return new TextDecoder().decode(b64uDecodeBytes(input));
}

/** Strip PEM armor + whitespace and decode the base64 body. */
export function pemToBytes(pem: string): Uint8Array {
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Decode a base64 (not -url) string to bytes — for SPKI pubkeys committed as plain base64. */
export function b64ToBytes(input: string): Uint8Array {
  const bin = atob(input);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Import an Ed25519 private key from PKCS8 PEM.
 * Throws if the runtime doesn't support Ed25519 (Workers compatibility flag
 * `nodejs_compat` + a recent compatibility_date is required).
 */
export async function importEd25519PrivateKey(pem: string): Promise<CryptoKey> {
  const bytes = pemToBytes(pem);
  return crypto.subtle.importKey("pkcs8", bytes.buffer as ArrayBuffer, { name: "Ed25519" }, false, [
    "sign",
  ]);
}

/**
 * Import an Ed25519 public key from base64-SPKI (the body of a PEM file with
 * the `-----BEGIN PUBLIC KEY-----` / `-----END PUBLIC KEY-----` lines and
 * newlines stripped — this is what's committed in
 * `packages/config/src/bouncer-attestation.ts`).
 */
export async function importEd25519PublicKey(b64Spki: string): Promise<CryptoKey> {
  const bytes = b64ToBytes(b64Spki);
  return crypto.subtle.importKey("spki", bytes.buffer as ArrayBuffer, { name: "Ed25519" }, false, [
    "verify",
  ]);
}
