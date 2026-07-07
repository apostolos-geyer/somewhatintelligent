import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import { parseRequestCookies } from "@si/auth";
import { createPlatformStartApp } from "@si/kit/react-start";
import { createGuestlistClient } from "@si/guestlist-service/client";
import { getGuestlist, guestlistFetcher } from "@/lib/guestlist";

// Composes the bouncer Ed25519-envelope verifier with a guestlist RPC fallback
// (mirrors workers/identity/src/lib/platform.ts). `getSession(headers)` returns
// the full PlatformSession; in staging/production bouncer mints the envelope,
// in local dev-direct `devEnvelopeStamper` self-mints it from the session
// cookie with the well-known dev key (BNC_ATT_KID/BNC_ATT_PRIV from .dev.vars).
export const platform = createPlatformStartApp({
  name: "store",
  getGuestlist,
  guestlistFetcher: guestlistFetcher as () => typeof fetch,
  getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT),
  // Bouncer stamps the envelope with the served (public) host; the store's own
  // public host is STORE_URL's host. Bouncer's service-binding loopback
  // rewrites Host in miniflare, so pin to the configured value.
  expectedHost: createServerOnlyFn(() => new URL(env.STORE_URL).hostname.toLowerCase()),
  devEnvelopeSigner: createServerOnlyFn(() => ({
    privPem: (env as { BNC_ATT_PRIV?: string }).BNC_ATT_PRIV ?? "",
    kid: (env as { BNC_ATT_KID?: string }).BNC_ATT_KID ?? "dev",
  })),
  devEnvelopeGuestlist: createServerOnlyFn((request: Request) => {
    const cookies = parseRequestCookies(request);
    return createGuestlistClient({
      baseURL: env.STORE_URL ?? "https://guestlist-service.localhost",
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
