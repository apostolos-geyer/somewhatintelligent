/**
 * Bouncer attestation envelope shape.
 *
 * The signed JWS payload that bouncer stamps onto every forwarded request
 * via `x-platform-att`. Apps verify against the public-key set in
 * `@greenroom/config`'s `BOUNCER_ATTESTATION_KEYS`.
 *
 * See `docs/ARCHITECTURE.md` §4.1.2.
 */

/** Identity payload included when the request has a resolved user. */
export interface EnvelopeActorUser {
  kind: "user";
  id: string;
  role: string | null;
  // Common UX fields — enough to render avatar/menu/header without an
  // app-side guestlist hop. Anything beyond this (org membership, 2FA, etc.)
  // requires `platform.getGuestlist()`.
  name?: string;
  email?: string;
  image?: string | null;
}

/**
 * Discriminated union of every actor kind the envelope can carry. Today the
 * only variant is `EnvelopeActorUser`; future kinds (service-to-service,
 * webhook sources) slot in without touching consumers that already branch on
 * `actor.kind`. See `docs/REQUEST-FLOW.md` §6.6.
 */
export type EnvelopeActor = EnvelopeActorUser;

/**
 * Session projection carried in the envelope. Safe subset of BA's full
 * session — no `token` (that's the cookie), no `ipAddress`/`userAgent`
 * (stale-prone). Apps that need those call `platform.getGuestlist().getSession()`.
 */
export interface EnvelopeSessionData {
  id: string;
  userId: string;
  /** Epoch seconds (JWS-friendly; apps convert to Date if needed). */
  expiresAt: number;
}

/** Signed JWS payload. */
export interface EnvelopePayload {
  /** Version tag. */
  v: 1;
  /** Issuer. */
  iss: "bouncer";
  /** Epoch seconds (issue time). */
  iat: number;
  /** Epoch seconds (expiry; iat + 30 in the default config). */
  exp: number;
  /** Public host bouncer routed (lowercased, no port). Replay-binding. */
  host: string;
  /** Resolved actor at envelope mint time, or null for public/optional traffic. */
  actor: EnvelopeActor | null;
  /** Session projection — null when `actor` is null. */
  session: EnvelopeSessionData | null;
  /**
   * Active organization id from session.activeOrganizationId at envelope mint
   * time. Apps that need org-membership role call
   * `authClient.organization.getActiveMemberRole({ query: { organizationId } })`
   * at the authz decision point — role isn't denormalized into the envelope.
   * Optional so old envelopes that predate this field still verify; absent
   * ↔ no active org.
   */
  activeOrgId?: string | null;
}

/** Result the verifier returns to the app. */
export type EnvelopeResult =
  | {
      kind: "valid";
      actor: EnvelopeActor | null;
      session: EnvelopeSessionData | null;
      activeOrgId: string | null;
    }
  | { kind: "missing" }
  | { kind: "invalid"; reason: string };

/**
 * Convenience shape for the "valid + authenticated" case.
 *
 * Apps that just need actor identity (auth gate, log correlation, header
 * rendering) consume this — the narrow, signed, no-I/O fast path. Apps that
 * need plugin-extended BA fields (`twoFactorEnabled`, `createdAt`, etc.) go
 * through `platform.getSession()` instead, which is a strict superset
 * sourced from guestlist.
 *
 * Returned as `null` by `platform.getEnvelope()` when the request is public
 * (no actor) — the envelope is still signed and verified in that case, but
 * there's no identity to surface.
 */
export interface EnvelopeData {
  actor: EnvelopeActorUser;
  session: EnvelopeSessionData;
  activeOrgId?: string | null;
}

/** Environment label. The verifier behaves differently per env. */
export type PlatformEnvironment = "development" | "staging" | "production";
