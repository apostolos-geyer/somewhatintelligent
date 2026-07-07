/**
 * Bouncer attestation envelope minter — used by `workers/bouncer/`.
 *
 * Signs an EnvelopePayload with Ed25519 and emits JWS-compact:
 *   base64url(joseHeader).base64url(payload).base64url(sig)
 *
 * The minter caches the imported CryptoKey for the lifetime of the worker
 * isolate, so per-request cost is one signature + two base64url encodes.
 */
import { b64uEncode, importEd25519PrivateKey } from "./jws";
import type { EnvelopeActorUser, EnvelopePayload, EnvelopeSessionData } from "./types";

export interface AttestationMinterOpts {
  /**
   * Ed25519 private key in PKCS8 PEM. Comes from bouncer's `BNC_ATT_PRIV`
   * wrangler secret.
   */
  privPem: string;
  /** Key id — bumped during rotation. Comes from bouncer's `BNC_ATT_KID` var. */
  kid: string;
  /** Envelope lifetime in seconds. Default 30. */
  ttlSeconds?: number;
}

export interface MintAttestationInput {
  /** Resolved actor, or `null` for public/optional traffic with no session. */
  actor: EnvelopeActorUser | null;
  /** Session projection — null whenever `actor` is null. */
  session: EnvelopeSessionData | null;
  /** Lowercased public host bouncer routed (no port). Replay-binding. */
  host: string;
  /** Active organization id (session.activeOrganizationId). Omit/null when none. */
  activeOrgId?: string | null;
}

export type AttestationMinter = (input: MintAttestationInput) => Promise<string>;

/**
 * Build a minter. Returns a function that takes per-request `{ actor, host }`
 * and produces a JWS-compact envelope string.
 *
 * The CryptoKey import is async; called once and cached.
 */
export async function createAttestationMinter(
  opts: AttestationMinterOpts,
): Promise<AttestationMinter> {
  const ttl = opts.ttlSeconds ?? 30;
  const key = await importEd25519PrivateKey(opts.privPem);
  const joseHeader = b64uEncode(JSON.stringify({ alg: "EdDSA", kid: opts.kid }));

  return async function mintAttestation(input): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const payload: EnvelopePayload = {
      v: 1,
      iss: "bouncer",
      iat,
      exp: iat + ttl,
      host: input.host,
      actor: input.actor,
      session: input.session,
      ...(input.activeOrgId !== undefined && { activeOrgId: input.activeOrgId }),
    };
    const payloadB64 = b64uEncode(JSON.stringify(payload));
    const signingInput = `${joseHeader}.${payloadB64}`;
    const signature = await crypto.subtle.sign(
      { name: "Ed25519" },
      key,
      new TextEncoder().encode(signingInput).buffer as ArrayBuffer,
    );
    const sigB64 = b64uEncode(new Uint8Array(signature));
    return `${joseHeader}.${payloadB64}.${sigB64}`;
  };
}
