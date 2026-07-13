// KEK loading. KEKs are 32 random bytes, base64, in versioned secret
// bindings (VAULT_KEK_V1, VAULT_KEK_V2, ...). Each is imported once per
// isolate as a NON-EXTRACTABLE AES-KW CryptoKey and memoized — raw KEK bytes
// exist only transiently during import (NFR-7, PRD §7).
import type { VaultEnv } from "../vault-env";

const kekCache = new Map<string, Promise<CryptoKey>>();

export function activeKekVersion(env: VaultEnv): number {
  const v = Number.parseInt(env.VAULT_ACTIVE_KEK_VERSION, 10);
  if (!Number.isInteger(v) || v < 1) {
    throw new Error("VAULT_ACTIVE_KEK_VERSION must be a positive integer");
  }
  return v;
}

export function kekBindingName(version: number): string {
  return `VAULT_KEK_V${version}`;
}

export function loadKek(env: VaultEnv, version: number): Promise<CryptoKey> {
  const name = kekBindingName(version);
  const b64 = (env as unknown as Record<string, unknown>)[name];
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error(`KEK binding ${name} is missing`);
  }
  // Cache key includes the material so a different binding value (tests,
  // rotated fork) can never be served a stale key.
  const cacheKey = `${name}:${b64}`;
  let key = kekCache.get(cacheKey);
  if (!key) {
    key = importKek(b64, name);
    kekCache.set(cacheKey, key);
  }
  return key;
}

async function importKek(b64: string, name: string): Promise<CryptoKey> {
  const raw = base64Decode(b64);
  if (raw.byteLength !== 32) {
    throw new Error(`KEK ${name} must be 32 bytes (got ${raw.byteLength})`);
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-KW" }, false, ["wrapKey", "unwrapKey"]);
}

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
