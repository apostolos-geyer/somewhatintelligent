import { env } from "cloudflare:workers";
import {
  createBouncerEnvelopeVerifier,
  createEnvelopeStamper,
  EnvelopeRejection,
  PLATFORM_HEADERS,
  stampPlatformHeaders,
  type PlatformEnvironment,
  type PlatformSession,
} from "@somewhatintelligent/auth";
import { extractPlatformRequestId } from "@somewhatintelligent/kit/request-context";
import { BOUNCER_ATTESTATION_KEYS } from "@si/config";
import { getGuestlist } from "@/lib/guestlist";

// Bouncer stamps the envelope with the served (public) host; the store's own
// public host is STORE_URL's host. Bouncer's service-binding loopback
// rewrites Host in miniflare, so pin to the configured value.
const expectedHost = () => new URL(env.STORE_URL).hostname.toLowerCase();

let _verifier: ReturnType<typeof createBouncerEnvelopeVerifier> | null = null;
function getVerifier() {
  return (_verifier ??= createBouncerEnvelopeVerifier({
    keys: BOUNCER_ATTESTATION_KEYS,
    env: env.ENVIRONMENT as PlatformEnvironment,
    expectedHost,
  }));
}

// Per-Headers memoization: N callers within one request share at most one
// verify + one guestlist RPC (mirrors kit's createPlatformStartApp, minus the
// TSS request-context dependency — store has none, so guestlist enrichment
// reads cookies straight off the given Headers via `getGuestlist(request)`
// (src/lib/guestlist.ts) rather than TSS's ambient H3 event).
const sessionInflight = new WeakMap<Headers, Promise<PlatformSession | null>>();

/**
 * Full BA-inferred `PlatformSession` by RPC to guestlist. Envelope is
 * verified as a precondition. In production a missing/invalid envelope
 * throws `EnvelopeRejection` inside the verifier — caught here and treated
 * as unauthenticated (`null`), since every store-api.ts route already gates
 * explicitly on a null session rather than expecting a thrown response.
 */
export function getSession(headers: Headers): Promise<PlatformSession | null> {
  const cached = sessionInflight.get(headers);
  if (cached) return cached;
  const promise = (async (): Promise<PlatformSession | null> => {
    const host = headers.get("host") ?? "__platform__.invalid";
    const request = new Request(`https://${host}/`, { headers });
    let result: Awaited<ReturnType<ReturnType<typeof createBouncerEnvelopeVerifier>>>;
    try {
      result = await getVerifier()(request);
    } catch (err) {
      if (err instanceof EnvelopeRejection) return null;
      throw err;
    }
    if (result.kind !== "valid" || !result.actor) return null;
    try {
      return await getGuestlist(request).getSession();
    } catch {
      return null;
    }
  })();
  sessionInflight.set(headers, promise);
  return promise;
}

// Dev-only envelope stamper: self-mints a bouncer envelope from the session
// cookie on dev-direct requests (no bouncer in front on
// *.somewhatintelligent.localhost). Hard no-op outside development. Forked
// inline from kit's createDevEnvelopeStamper (react-start barrel) rather than
// imported — that barrel's service-clients.ts pulls in
// @tanstack/react-start/server (getCookies/getRequest), which only resolves
// inside a real TanStack Start Vite build; store has none.
export interface DevEnvelopeStampOutcome {
  request: Request;
  setCookies: string[];
}

let _stamperPromise: ReturnType<typeof createEnvelopeStamper> | null = null;
function getStamper() {
  return (_stamperPromise ??= createEnvelopeStamper({
    sessionResolver: async (request) => {
      try {
        const session = await getGuestlist(request).getSession();
        return { session, setCookies: [] };
      } catch {
        return { session: null, setCookies: [] };
      }
    },
    minter: {
      privPem: (env as { BNC_ATT_PRIV?: string }).BNC_ATT_PRIV ?? "",
      kid: (env as { BNC_ATT_KID?: string }).BNC_ATT_KID ?? "dev",
      ttlSeconds: 30,
    },
    resolveHost: expectedHost,
  }));
}

export async function devEnvelopeStamper(request: Request): Promise<DevEnvelopeStampOutcome> {
  // Widened to string: the generated ENVIRONMENT union depends on whether
  // .dev.vars existed at `wrangler types` time (CI regenerates without it).
  const environment: string = env.ENVIRONMENT;
  if (environment !== "development") return { request, setCookies: [] };
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
    console.warn("store:dev-envelope stamp failed; passthrough", {
      message: err instanceof Error ? err.message : String(err),
    });
    return { request, setCookies: [] };
  }
}
