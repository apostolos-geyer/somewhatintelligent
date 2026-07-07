/**
 * SAFETY: this module mints bouncer-issued envelopes from inside the app.
 * It is a forgery surface unless gated to `ENVIRONMENT === "development"`.
 * In dev-direct topology (Appendix A of `docs/ARCHITECTURE.md`), bouncer is
 * not in the path on public-host requests to apps, so `x-platform-att` is
 * absent and every server fn that calls `getEnvelope` breaks. This stamper
 * lets dev apps self-mint with the well-known dev key (LOCAL_BNC_ATT_PRIV /
 * kid="dev") so the prod codepath runs verbatim. In staging/production the
 * stamper is a hard no-op: only bouncer holds the live signing key, and a
 * locally-minted envelope under a real kid would bypass the platform's only
 * authoritative actor-resolution step.
 *
 * Per `docs/REQUEST-FLOW.md` §6.5 — dev-direct shares bouncer's mint code via
 * `@si/auth`'s `createEnvelopeStamper`.
 */
import { createServerOnlyFn } from "@tanstack/react-start";
import {
  createEnvelopeStamper,
  PLATFORM_HEADERS,
  stampPlatformHeaders,
  type EnvelopeStamper,
  type SessionResolver,
  type SessionResolverResult,
  type StampableSession,
} from "@si/auth";
import { extractPlatformRequestId } from "../request-context";

export type { StampableSession };

export interface DevEnvelopeStamperOpts<C extends GuestlistClientShape> {
  /**
   * Env-label thunk. Stamper is active only when this returns
   * `"development"`. Any other value (including `undefined`, `"staging"`,
   * `"production"`) makes the stamper a passthrough — see SAFETY note above.
   */
  getEnvironment: () => string | undefined;
  /**
   * Returns the bouncer signing key + kid. Only invoked when the env is
   * `"development"` AND no envelope is present on the request — apps that
   * don't ship `BNC_ATT_PRIV` in their dev env never call it.
   */
  getSigner: () => { privPem: string; kid: string };
  /**
   * Returns the guestlist client to use for resolving the BA session.
   * Receives the dev request so apps can build a cookie-adapter scoped to
   * the per-request cookie jar (the same pattern `createGuestlistFactory`
   * uses, but without `getRequest()`'s H3 context — we're outside TSS).
   */
  getGuestlist: (request: Request) => C;
  /**
   * Resolves the public host the envelope is bound to. Defaults to
   * `new URL(request.url).hostname.toLowerCase()`. Apps reached via a
   * service-binding loopback (which rewrites Host) should pin it.
   */
  expectedHost?: string | ((request: Request) => string);
  /** Envelope TTL in seconds. Default 30 (matches bouncer). */
  ttlSeconds?: number;
}

export interface GuestlistClientShape {
  getSession: () => Promise<StampableSession | null>;
}

/**
 * Result of running the dev stamper: the stamped request to forward into
 * TSS, plus any `Set-Cookie` headers BA wrote during session resolution
 * that the caller must propagate on the response back to the browser.
 */
export interface DevEnvelopeStampOutcome {
  request: Request;
  setCookies: string[];
}

export type DevEnvelopeStamper = (request: Request) => Promise<DevEnvelopeStampOutcome>;

export function createDevEnvelopeStamper<C extends GuestlistClientShape>(
  opts: DevEnvelopeStamperOpts<C>,
): DevEnvelopeStamper {
  const resolveHost: (req: Request) => string =
    typeof opts.expectedHost === "string"
      ? () => opts.expectedHost as string
      : typeof opts.expectedHost === "function"
        ? opts.expectedHost
        : (req) => new URL(req.url).hostname.toLowerCase();

  let stamperPromise: Promise<EnvelopeStamper> | null = null;
  function getStamper(): Promise<EnvelopeStamper> {
    if (stamperPromise) return stamperPromise;
    const signer = opts.getSigner();
    const sessionResolver: SessionResolver = async (request) => {
      try {
        const guestlist = opts.getGuestlist(request);
        const session = await guestlist.getSession();
        return { session, setCookies: [] } satisfies SessionResolverResult;
      } catch {
        return { session: null, setCookies: [] } satisfies SessionResolverResult;
      }
    };
    stamperPromise = createEnvelopeStamper({
      sessionResolver,
      minter: { privPem: signer.privPem, kid: signer.kid, ttlSeconds: opts.ttlSeconds ?? 30 },
      resolveHost,
    });
    return stamperPromise;
  }

  // Wrapped in `createServerOnlyFn` so the body — and its static reference
  // to `extractPlatformRequestId` from `../request-context` — is stripped
  // from the client bundle. Apps reach this factory's RETURN value via
  // `lib/platform.ts`'s `createPlatformStartApp` call at module-top, which
  // is reachable from `__root.tsx`'s `session.functions` chain in the
  // client environment. Without the wrap, the closure keeps
  // `kit/request-context`'s `new AsyncLocalStorage()` alive in the browser.
  return createServerOnlyFn(async function stamp(
    request: Request,
  ): Promise<DevEnvelopeStampOutcome> {
    if (opts.getEnvironment() !== "development") return { request, setCookies: [] };
    if (request.headers.get(PLATFORM_HEADERS.att)) return { request, setCookies: [] };

    try {
      const stamper = await getStamper();
      const { envelope, setCookies, actor } = await stamper(request);
      const stamped = stampPlatformHeaders(request, {
        envelope,
        actor,
        requestId: extractPlatformRequestId(request),
      });
      return { request: stamped, setCookies };
    } catch (err) {
      console.warn("kit:dev-envelope stamp failed; passthrough", {
        message: err instanceof Error ? err.message : String(err),
      });
      return { request, setCookies: [] };
    }
  });
}
