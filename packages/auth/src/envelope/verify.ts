/**
 * Bouncer attestation envelope verifier — used by every app + non-Start
 * worker that participates in the platform.
 *
 * Verifies a JWS-compact value against a public-key set keyed by `kid`.
 * Hardcoded `alg: "EdDSA"` (no algorithm negotiation; rejects `alg: "none"`
 * and HS256 confusion attacks). Binds against `host` (lowercased) and
 * checks `iat`/`exp` with a small clock-skew tolerance.
 *
 * Dev/prod gate is baked in:
 *   - production + missing  → throws (`bouncer_required`)
 *   - production + invalid  → throws (`envelope_invalid`)
 *   - dev/staging + missing → returns kind:"missing"; caller falls back to guestlist
 *   - dev/staging + invalid → logs + returns kind:"missing"; caller falls back
 *
 * Construction asserts non-empty `keys` when env is production — a
 * misconfigured worker fails to boot, not silently at request time.
 */
import { PLATFORM_HEADERS } from "../platform-headers";
import { b64uDecodeBytes, b64uDecodeString, importEd25519PublicKey } from "./jws";
import type { EnvelopePayload, EnvelopeResult, PlatformEnvironment } from "./types";

export interface BouncerEnvelopeVerifierOpts {
  /** kid → base64-SPKI Ed25519 public key. Typically `BOUNCER_ATTESTATION_KEYS` from `@si/config`. */
  keys: Record<string, string>;
  /** Runtime environment label. Drives the missing/invalid gate. */
  env: PlatformEnvironment;
  /** Extract the public host the request claimed. Verifier compares against payload.host. */
  expectedHost: (req: Request) => string;
  /** Clock-skew tolerance in seconds for iat. Default 5. */
  skewSeconds?: number;
}

export type BouncerEnvelopeVerifier = (req: Request) => Promise<EnvelopeResult>;

/**
 * Build a verifier. CryptoKey imports are lazy + cached per kid for the
 * lifetime of the worker isolate.
 */
export function createBouncerEnvelopeVerifier(
  opts: BouncerEnvelopeVerifierOpts,
): BouncerEnvelopeVerifier {
  const { keys, env, expectedHost, skewSeconds = 5 } = opts;

  if (env === "production" && Object.keys(keys).length === 0) {
    throw new Error(
      "createBouncerEnvelopeVerifier: production env requires a non-empty key set; " +
        "ensure BOUNCER_ATTESTATION_KEYS in @si/config is populated.",
    );
  }

  const keyCache = new Map<string, Promise<CryptoKey>>();
  function getKey(kid: string): Promise<CryptoKey> | null {
    const b64 = keys[kid];
    if (!b64) return null;
    let p = keyCache.get(kid);
    if (!p) {
      p = importEd25519PublicKey(b64);
      keyCache.set(kid, p);
    }
    return p;
  }

  const isProd = env === "production";

  return async function verifyEnvelope(req: Request): Promise<EnvelopeResult> {
    const raw = req.headers.get(PLATFORM_HEADERS.att);
    if (!raw) {
      if (isProd) throw new EnvelopeRejection("bouncer_required");
      return { kind: "missing" };
    }

    const invalid = (reason: string): EnvelopeResult => {
      if (isProd) throw new EnvelopeRejection(reason);
      console.warn("envelope_invalid", { reason });
      return { kind: "invalid", reason };
    };

    const parts = raw.split(".");
    if (parts.length !== 3) return invalid("malformed_jws");
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    // Parse + check header.
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(b64uDecodeString(headerB64));
    } catch {
      return invalid("header_parse");
    }
    if (header.alg !== "EdDSA") return invalid("alg_not_eddsa");
    if (typeof header.kid !== "string") return invalid("kid_missing");

    // Look up key. Unknown kid → reject.
    const keyPromise = getKey(header.kid);
    if (!keyPromise) return invalid("kid_unknown");

    // Verify signature BEFORE trusting any payload field.
    let key: CryptoKey;
    try {
      key = await keyPromise;
    } catch {
      return invalid("key_import_failed");
    }
    const signingInput = `${headerB64}.${payloadB64}`;
    let ok: boolean;
    try {
      ok = await crypto.subtle.verify(
        { name: "Ed25519" },
        key,
        b64uDecodeBytes(sigB64).buffer as ArrayBuffer,
        new TextEncoder().encode(signingInput).buffer as ArrayBuffer,
      );
    } catch {
      return invalid("verify_threw");
    }
    if (!ok) return invalid("bad_signature");

    // Signature verified — now parse + validate payload.
    let payload: EnvelopePayload;
    try {
      payload = JSON.parse(b64uDecodeString(payloadB64));
    } catch {
      return invalid("payload_parse");
    }

    if (payload.v !== 1) return invalid("version");
    if (payload.iss !== "bouncer") return invalid("issuer");

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.iat !== "number" || payload.iat > now + skewSeconds) {
      return invalid("iat_future");
    }
    if (typeof payload.exp !== "number" || payload.exp <= now) {
      return invalid("expired");
    }

    const expected = expectedHost(req).toLowerCase();
    if (payload.host.toLowerCase() !== expected) return invalid("host_mismatch");

    // Cross-field invariant: actor null ↔ session null.
    if ((payload.actor === null) !== (payload.session === null)) {
      return invalid("actor_session_mismatch");
    }

    return {
      kind: "valid",
      actor: payload.actor,
      session: payload.session,
      activeOrgId: payload.activeOrgId ?? null,
    };
  };
}

/**
 * Thrown by the verifier in production when the envelope is missing or
 * invalid. Carries a short reason code for canonical-log fields.
 */
export class EnvelopeRejection extends Error {
  override name = "EnvelopeRejection" as const;
  constructor(public readonly reason: string) {
    super(`envelope rejected: ${reason}`);
  }
}
