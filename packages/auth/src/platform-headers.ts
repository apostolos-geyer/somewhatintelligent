/**
 * The platform's internal header contract.
 *
 * Every CF Worker that participates in the platform — bouncer, apps,
 * guestlist, roadie, promoter — reads and writes these headers. Only bouncer
 * translates `cf-*` to `x-platform-*`; everyone else speaks the internal
 * contract directly.
 *
 * Adding a new privileged header: edit this file, the `PLATFORM_HEADERS`
 * const, the `PlatformRequestContract` interface, and bouncer's
 * `stampUpstreamHeaders` strip-then-stamp list in `workers/bouncer/src/proxy.ts`.
 *
 * See `docs/ARCHITECTURE.md` §4.1.1.
 */
export const PLATFORM_HEADERS = {
  /** Canonical request id. Bouncer stamps from cf-request-id; apps mint when alone. */
  rid: "x-platform-rid",
  /** Bouncer attestation envelope (JWS-compact, Ed25519). */
  att: "x-platform-att",
  /** Calling worker name: "bouncer", "identity", etc. */
  caller: "x-platform-caller",
  actor: {
    /** "user" | "service" — log correlation only; never feeds authz. */
    kind: "x-platform-actor-kind",
    /** Actor id — userId for user, serviceName for service; log correlation only. */
    id: "x-platform-actor-id",
  },
} as const;

/**
 * Shape of the headers a platform worker can read off an inbound request.
 * All fields are optional except `rid` (which the entry shim always
 * extracts — minting if absent).
 */
export interface PlatformRequestContract {
  /** Required on every internal request. Minted by entry shim if absent. */
  rid: string;
  /** Present on bouncer → app traffic. Absent on worker → worker traffic. */
  att?: string;
  /** Calling worker name. */
  caller?: string;
  /** Caller-asserted actor kind. LOG CORRELATION ONLY. */
  actorKind?: "user" | "service";
  /** Caller-asserted actor id. LOG CORRELATION ONLY. */
  actorId?: string;
}
