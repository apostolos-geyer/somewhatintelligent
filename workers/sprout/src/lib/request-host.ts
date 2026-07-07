/**
 * The routing host for the current request, resolved with the platform's single
 * extraction rule (`@greenroom/auth` `routingHostFromHeaders`) — the SAME rule
 * bouncer and the dev-envelope stamper use. In dev (portless rewrites `Host` to
 * the app's own name) the real client host is `x-forwarded-host`; in prod it's
 * `Host`. So a brand subdomain resolves identically here, in the attested
 * envelope, and at the edge. Server-only (reads request headers + env).
 */
import { getCookie, getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { routingHostFromHeaders } from "@greenroom/kit/request-context";
import { BRAND_COOKIE, resolveBrandSlug } from "@/lib/brand-resolution";

export function getRequestHost(): string | null {
  return routingHostFromHeaders(getRequestHeaders(), {
    // `as string`: dev's ENVIRONMENT comes from .dev.vars, outside the
    // generated config union — see the note in platform.ts.
    trustForwardedHost: (env.ENVIRONMENT as string) === "development",
  });
}

/**
 * The brand slug for the current request under the build-time addressing
 * strategy (`brand-resolution.ts`): the host label in `subdomain` mode, the
 * `sprout_brand` cookie in `path` mode. Reads BOTH facts here (server-only) and
 * lets the pure strategy table pick — the one place server fns resolve "which
 * brand am I looking at", whether the call is a page load or a server-fn POST.
 */
export function getRequestBrandSlug(): string | null {
  return resolveBrandSlug({
    host: getRequestHost(),
    brandCookie: getCookie(BRAND_COOKIE) ?? null,
  });
}
