/**
 * Secret/key generators. Pure (given the system CSPRNG) and format-exact so the
 * output drops straight into the consumers: better-auth's secret, and the
 * bouncer attestation keypair whose public half lives in
 * `packages/config/src/bouncer-attestation.ts`.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes } from "node:crypto";

/** better-auth signing secret: 32 random bytes, base64 — matches the dev one. */
export function generateBetterAuthSecret(): string {
  return randomBytes(32).toString("base64");
}

export interface Ed25519Keypair {
  /** PKCS8 PEM, with BEGIN/END headers — the BNC_ATT_PRIV secret value. */
  privatePem: string;
  /** SPKI DER, base64, no headers — the form stored in bouncer-attestation.ts. */
  publicSpkiB64: string;
}

/** Fresh Ed25519 attestation keypair in the exact formats the platform uses. */
export function generateEd25519(): Ed25519Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const privatePem = (privateKey.export({ type: "pkcs8", format: "pem" }) as string).trim();
  const publicSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString(
    "base64",
  );
  return { privatePem, publicSpkiB64 };
}

/**
 * Derive the SPKI-base64 public key (config format) from a stored PKCS8 PEM
 * private key. Lets the provisioner keep `bouncer-attestation.ts` in sync with
 * whatever private key is in the value store, idempotently.
 */
export function publicFromPrivatePem(privatePem: string): string {
  const pub = createPublicKey(createPrivateKey(privatePem));
  return (pub.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
}
