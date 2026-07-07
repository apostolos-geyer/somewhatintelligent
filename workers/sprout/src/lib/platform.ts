// Platform surface. Every `env`-touching closure goes through
// `createServerOnlyFn` to keep wrangler bindings out of the client bundle.
// See ARCHITECTURE.md §3.3 / §4.2 / §4.5 (dev-envelope stamper).
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { parseRequestCookies } from "@greenroom/auth";
import { createPlatformStartApp } from "@greenroom/kit/react-start";
import { createGuestlistClient } from "@greenroom/guestlist-service/client";
import { getGuestlist, guestlistFetcher } from "@/lib/guestlist";
import { normalizePrivPem } from "@/lib/pem";

export const platform = createPlatformStartApp({
  name: "sprout",
  getGuestlist,
  guestlistFetcher: guestlistFetcher as () => typeof fetch,
  getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT),
  // Bouncer stamps the envelope with the incoming request host and forwards the
  // request with that Host intact (real Cloudflare). In production the portal is
  // served on many hosts — the global Hub at apex/www `/hub` and every org at
  // `<org>.sproutportal.ca` — so accept the bouncer-stamped served host. This
  // also PRESERVES cross-host replay protection: an envelope minted for org A
  // won't verify against org B (payload.host != req host). Only DEV differs: the
  // miniflare service-binding loopback rewrites the Host header, so req.url is
  // unreliable there — pin to SPROUT_URL. In staging the sole host reaching this
  // worker is sprout-staging.sproutportal.ca, so the else branch equals the old
  // pinned value (no behaviour change). Mirrors room-server.ts's expectedHost.
  expectedHost: createServerOnlyFn((req: Request) =>
    // `as string`: generated Env types ENVIRONMENT as the wrangler.jsonc
    // section union ("staging" | "production"); dev's "development" comes from
    // .dev.vars, which CI's type generation deliberately never sees. Same
    // pattern: request-host.ts + workers/bouncer/src/index.ts.
    (env.ENVIRONMENT as string) === "development"
      ? new URL(env.SPROUT_URL).hostname.toLowerCase()
      : new URL(req.url).hostname.toLowerCase(),
  ),
  devEnvelopeSigner: createServerOnlyFn(() => ({
    // .dev.vars stores the PEM with escaped newlines (\n); importPKCS8 needs
    // real newlines, so unescape before handing it to the dev stamper.
    privPem: normalizePrivPem((env as { BNC_ATT_PRIV?: string }).BNC_ATT_PRIV),
    kid: (env as { BNC_ATT_KID?: string }).BNC_ATT_KID ?? "dev",
  })),
  // Build a fresh guestlist client per request: the stamper runs before TSS
  // captures the H3 event, so the default factory's cookie reader sees no
  // cookies. Matches workers/bouncer/src/session.ts.
  devEnvelopeGuestlist: createServerOnlyFn((request: Request) => {
    const cookies = parseRequestCookies(request);
    return createGuestlistClient({
      baseURL: env.IDENTITY_URL ?? "https://guestlist-service.localhost",
      fetchOptions: { customFetchImpl: env.GUESTLIST.fetch.bind(env.GUESTLIST) as typeof fetch },
      cookies: { getAll: () => cookies, setAll: () => {} },
    });
  }),
});

export const {
  getSession,
  getEnvelope,
  getActiveOrgId,
  envelopeMiddleware,
  apiProxyHandlers,
  devEnvelopeStamper,
} = platform;
