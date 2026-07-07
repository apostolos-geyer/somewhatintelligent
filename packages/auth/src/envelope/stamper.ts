/**
 * Shared envelope stamper. The single implementation of "resolve session,
 * project to envelope payload, sign" used by bouncer in prod/staging/dev and
 * by app workers' dev-direct entry middleware when bouncer isn't in the path.
 *
 * See `docs/REQUEST-FLOW.md` §6 + §9 phase 2.
 */
import { createAttestationMinter, type AttestationMinterOpts } from "./mint";
import { PLATFORM_HEADERS } from "../platform-headers";
import type { EnvelopeActor, EnvelopeActorUser, EnvelopeSessionData } from "./types";

/**
 * Structural subset of the BA session the stamper projects into the envelope.
 * Intentionally narrower than `PlatformSession` so tests + non-Better-Auth
 * adapters can satisfy the shape without faking unused fields (token,
 * createdAt, plugin-extended user data, etc.).
 */
export interface StampableSession {
  user: {
    id: string;
    role?: string | null;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
    activeOrganizationId?: string | null;
  };
}

/** Output of a session resolver — session payload plus any cookies BA wrote during lookup. */
export interface SessionResolverResult {
  session: StampableSession | null;
  /** Set-Cookie headers BA wrote (cookie cache rotation, etc.). Empty for the anonymous path. */
  setCookies: string[];
}

export type SessionResolver = (request: Request) => Promise<SessionResolverResult>;

export interface EnvelopeStamperOpts {
  /**
   * Resolve the session for this request. The edge (bouncer or dev-direct
   * worker entry) builds the guestlist client with whatever cookie-capture
   * adapter it needs, calls `guestlist.getSession()`, and surfaces any
   * Set-Cookie headers BA wrote. `{ session: null, setCookies: [] }` is a
   * valid stamp input — anonymous traffic gets a signed envelope too.
   */
  sessionResolver: SessionResolver;
  /** Ed25519 signing config — passed through to `createAttestationMinter`. */
  minter: AttestationMinterOpts;
  /** Lowercased public host the envelope binds to (replay protection). */
  resolveHost: (request: Request) => string;
}

export interface StampResult {
  /** Signed JWS-compact envelope, ready for the x-platform-att header. */
  envelope: string;
  /** Cookies the edge must propagate on its response. Empty when no BA refresh fired. */
  setCookies: string[];
  /** Resolved actor (for log enrichment). */
  actor: EnvelopeActor | null;
  /** Active org id (for log enrichment). */
  activeOrgId: string | null;
}

export type EnvelopeStamper = (request: Request) => Promise<StampResult>;

export async function createEnvelopeStamper(opts: EnvelopeStamperOpts): Promise<EnvelopeStamper> {
  const mint = await createAttestationMinter(opts.minter);
  return async function stamp(request: Request): Promise<StampResult> {
    const { session: resolved, setCookies } = await opts.sessionResolver(request);
    const actor = resolved ? toEnvelopeActor(resolved.user) : null;
    const session = resolved ? toEnvelopeSession(resolved.session) : null;
    const activeOrgId = resolved?.session.activeOrganizationId ?? null;
    const envelope = await mint({
      actor,
      session,
      activeOrgId,
      host: opts.resolveHost(request),
    });
    return { envelope, setCookies, actor, activeOrgId };
  };
}

export function toEnvelopeActor(user: StampableSession["user"]): EnvelopeActorUser {
  return {
    kind: "user",
    id: user.id,
    role: user.role ?? null,
    ...(user.name != null && { name: user.name }),
    ...(user.email != null && { email: user.email }),
    ...(user.image !== undefined && { image: user.image }),
  };
}

export function toEnvelopeSession(session: StampableSession["session"]): EnvelopeSessionData {
  return {
    id: session.id,
    userId: session.userId,
    expiresAt: Math.floor(session.expiresAt.getTime() / 1000),
  };
}

export interface StampPlatformHeadersOpts {
  /** Signed JWS-compact envelope to set on `x-platform-att`. */
  envelope: string;
  /** Resolved actor — null for anonymous traffic; the actor-correlation headers are skipped when null. */
  actor: EnvelopeActor | null;
  /** Canonical request id to set on `x-platform-rid` (and mirror on `cf-request-id` for back-compat). */
  requestId: string;
  /**
   * Calling worker name for `x-platform-caller`. Bouncer passes `"bouncer"`.
   * Omitted in dev-direct topology where the app's own entry IS the trust
   * boundary — no upstream platform worker, so the field stays absent.
   */
  caller?: string;
}

/**
 * Apply the platform's internal header contract to a request before it
 * crosses a trust boundary. Strip-then-stamp — every header in the contract
 * is deleted from the inbound request first, then re-set from the supplied
 * opts. No client-supplied value of any privileged header survives.
 *
 * Used at every edge that mints envelopes (bouncer in prod, dev stamper in
 * portless) so downstream workers see one uniform header surface.
 */
export function stampPlatformHeaders(request: Request, opts: StampPlatformHeadersOpts): Request {
  const headers = new Headers(request.headers);

  headers.delete(PLATFORM_HEADERS.rid);
  headers.delete(PLATFORM_HEADERS.att);
  headers.delete(PLATFORM_HEADERS.caller);
  headers.delete(PLATFORM_HEADERS.actor.kind);
  headers.delete(PLATFORM_HEADERS.actor.id);
  headers.delete("cf-request-id");

  headers.set(PLATFORM_HEADERS.rid, opts.requestId);
  headers.set("cf-request-id", opts.requestId);
  if (opts.caller) headers.set(PLATFORM_HEADERS.caller, opts.caller);
  headers.set(PLATFORM_HEADERS.att, opts.envelope);
  if (opts.actor) {
    headers.set(PLATFORM_HEADERS.actor.kind, opts.actor.kind);
    headers.set(PLATFORM_HEADERS.actor.id, opts.actor.id);
  }

  return new Request(request, { headers });
}
