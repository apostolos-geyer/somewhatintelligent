/**
 * Bouncer attestation public-key set.
 *
 * Maps `kid` → base64-encoded SPKI Ed25519 public key (the X.509 SPKI body
 * between the PEM `-----BEGIN PUBLIC KEY-----` / `-----END PUBLIC KEY-----`
 * markers, with newlines stripped). The verifier in `@si/auth` imports
 * this map and accepts any envelope whose JWS header `kid` matches one of
 * these entries — supports rolling rotation with overlap.
 *
 * Public keys are NOT secrets. This file is committed; rotation is a code
 * change (PR) plus a single `wrangler secret put` for bouncer's private key.
 * See `docs/secrets.md` §"Rotating BNC_ATT_PRIV" for the runbook.
 *
 * The `dev` kid is a well-known dev keypair shared with `scripts/dev-config.ts`
 * (`LOCAL_BNC_ATT_PRIV`). It only signs envelopes on `.somewhatintelligent.localhost`,
 * so the keypair is intentionally public. Rotate it per fork before any
 * non-local deploy.
 *
 * Production rotation:
 *   1. Add new `<kid>: <pub-b64>` here; both old and new accepted.
 *   2. `wrangler secret put BNC_ATT_PRIV` on bouncer with new private key,
 *      bump bouncer's `BNC_ATT_KID` var to the new kid.
 *   3. Drop the old `kid` from this map after the 30-second envelope `exp`
 *      window passes (i.e. on the next deploy).
 */
export const BOUNCER_ATTESTATION_KEYS = {
  /** Well-known dev keypair — paired with `LOCAL_BNC_ATT_PRIV` in scripts/dev-config.ts. */
  dev: "MCowBQYDK2VwAyEAfw6nHplwIGKJBTJeITzErHw5kQej7FjhrcNIWEbP5cg=",
  /** Production — paired private key is si-bouncer-production's BNC_ATT_PRIV secret. */
  production: "MCowBQYDK2VwAyEAfOxYC2R3pp5KChlmBnpM2TyfPIoFcvbjZT7KO0yjfXU=",
} as const satisfies Record<string, string>;

export type BouncerAttestationKid = keyof typeof BOUNCER_ATTESTATION_KEYS;
