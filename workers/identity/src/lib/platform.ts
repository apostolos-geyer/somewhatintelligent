// Platform surface. Every `env`-touching closure goes through
// `createServerOnlyFn` to keep wrangler bindings out of the client bundle.
// See ARCHITECTURE.md §3.3 / §4.2 / §4.5 (dev-envelope stamper).
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { parseRequestCookies } from "@greenroom/auth";
import { createPlatformStartApp } from "@greenroom/kit/react-start";
import { createGuestlistClient } from "@greenroom/guestlist-service/client";
import { getGuestlist, guestlistFetcher } from "@/lib/guestlist";

export const platform = createPlatformStartApp({
  name: "identity",
  getGuestlist,
  guestlistFetcher: guestlistFetcher as () => typeof fetch,
  getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT),
  // Bouncer service-binding loopback rewrites Host in miniflare; pin to IDENTITY_URL.
  expectedHost: createServerOnlyFn(() => new URL(env.IDENTITY_URL).hostname.toLowerCase()),
  // Dev-direct topology has no bouncer to mint the attestation envelope, so the
  // app stamps its own from the session cookie — without it the envelope-only
  // principal (and thus the admin gate / admin server fns) has no actor in dev.
  // Hard no-op outside dev and when an envelope is already present. Mirrors
  // workers/sprout/src/lib/platform.ts.
  devEnvelopeSigner: createServerOnlyFn(() => ({
    privPem: (env as { BNC_ATT_PRIV?: string }).BNC_ATT_PRIV ?? "",
    kid: (env as { BNC_ATT_KID?: string }).BNC_ATT_KID ?? "dev",
  })),
  // Fresh guestlist client per request: the stamper runs before TSS captures
  // the H3 event, so the default factory's cookie reader sees no cookies.
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
  getActiveOrgId,
  envelopeMiddleware,
  apiProxyHandlers,
  devEnvelopeStamper,
} = platform;
