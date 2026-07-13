// Envelope engine (PRD §7). Per-grant DEK (32 random bytes) used as an
// AES-256-GCM key for the payload blob; DEK wrapped with a versioned KEK via
// AES-KW and stored beside the ciphertext. WebCrypto only.
//
// Rotation note: the PRD asks for AAD to bind kekVersion AND for rotation to
// leave payload ciphertext untouched — those are mutually exclusive under
// GCM (decryption requires the exact sealing AAD). We keep the full AAD
// binding and RE-SEAL the payload (same DEK, fresh IV, new-kekVersion AAD)
// during rotation; the blob is <1 KB so the extra GCM op is negligible.
import type { GrantEnv, GrantKind } from "../types";
import { buildAad, type AadParts } from "./aad";

/**
 * The one plaintext credential blob, canonical JSON, encrypted atomically.
 * Exists in memory only inside the tenant DO during an operation (NFR-3).
 */
export interface GrantPayload {
  kind: GrantKind;
  accessToken?: string;
  refreshToken?: string;
  /** API keys and PATs both live here. */
  apiKey?: string;
  scopes: string[];
  obtainedAt: number;
  /** ms epoch access-token expiry, when known. */
  expiresAt?: number;
}

export interface SealedPayload {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

export function generateDek(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/** Import raw DEK bytes for sealing. Raw bytes must stay function-scoped. */
export function importDek(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Wrap a DEK under a KEK (AES-KW). The DEK CryptoKey must be extractable. */
export async function wrapDek(dek: CryptoKey, kek: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.wrapKey("raw", dek, kek, "AES-KW"));
}

/**
 * Unwrap a stored DEK. `extractable` defaults to false (decrypt paths);
 * rotation passes true transiently so the DEK can be re-wrapped under the
 * new KEK.
 */
export async function unwrapDek(
  wrapped: Uint8Array,
  kek: CryptoKey,
  opts?: { extractable?: boolean },
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    wrapped as BufferSource,
    kek,
    "AES-KW",
    { name: "AES-GCM" },
    opts?.extractable ?? false,
    ["encrypt", "decrypt"],
  );
}

export async function sealPayload(
  payload: GrantPayload,
  dek: CryptoKey,
  aad: AadParts,
): Promise<SealedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: buildAad(aad) as BufferSource },
      dek,
      new TextEncoder().encode(JSON.stringify(payload)),
    ),
  );
  return { ciphertext, iv };
}

/** Throws (OperationError) on any tamper: ciphertext, IV, or AAD mismatch. */
export async function openPayload(
  sealed: SealedPayload,
  dek: CryptoKey,
  aad: AadParts,
): Promise<GrantPayload> {
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: sealed.iv as BufferSource,
      additionalData: buildAad(aad) as BufferSource,
    },
    dek,
    sealed.ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as GrantPayload;
}

export type { GrantEnv };
