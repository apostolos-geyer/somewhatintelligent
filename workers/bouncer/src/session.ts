import { createGuestlistClient } from "@si/guestlist-service/client";
import { getRequestContext, getRequestId } from "@si/kit/request-context";
import {
  parseRequestCookies,
  type SessionResolver,
  type SessionResolverResult,
  type StampableSession,
} from "@si/auth";
import { platformConfig } from "@si/config";
import { type CookieSerializeOptions, parse as parseCookieHeader, serialize } from "cookie-es";

const SESSION_TOKEN_COOKIE = `${platformConfig.cookies.prefix}.session_token`;

export interface BouncerSessionResolverEnv {
  GUESTLIST: Fetcher;
}

/**
 * Bouncer-side session resolver. Builds a per-request guestlist client whose
 * cookie adapter captures any Set-Cookie BA writes during `getSession` (cache
 * rotation, session refresh) so the edge can propagate them on the response.
 */
export function createBouncerSessionResolver(env: BouncerSessionResolverEnv): SessionResolver {
  return async function resolve(request: Request): Promise<SessionResolverResult> {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader || !cookieHeader.includes(SESSION_TOKEN_COOKIE)) {
      return { session: null, setCookies: [] };
    }

    const captured: Array<{
      name: string;
      value: string;
      options?: CookieSerializeOptions;
    }> = [];
    try {
      const incoming = parseRequestCookies(request);
      const guestlist = createGuestlistClient({
        baseURL: "https://guestlist.internal",
        fetchOptions: {
          customFetchImpl: env.GUESTLIST.fetch.bind(env.GUESTLIST) as typeof fetch,
        },
        cookies: {
          getAll: () => incoming,
          setAll: (cookies) => {
            captured.push(...cookies);
          },
        },
        callerApp: "bouncer",
        getRequestId: () => getRequestId() ?? "",
        getActor: () => {
          const ctx = getRequestContext();
          return ctx?.actorKind === "user" && ctx.actorId
            ? { kind: "user", userId: ctx.actorId }
            : null;
        },
      });
      const refreshed = (await guestlist.getSession()) as StampableSession | null;
      const setCookies = captured.map((c) => serialize(c.name, c.value, c.options));
      return { session: refreshed, setCookies };
    } catch (err) {
      console.warn("bouncer:resolveSession failed open", {
        message: err instanceof Error ? err.message : String(err),
      });
      return { session: null, setCookies: [] };
    }
  };
}

/**
 * Merge BA-emitted Set-Cookie values into the forwarded request's Cookie
 * header so the downstream app sees the rotated session_data cookie on its
 * own subsequent guestlist calls (e.g. `loadSession`). Without this, the app
 * would re-issue with the pre-rotation cookie and BA would refresh again.
 */
export function mergeCookiesIntoRequest(request: Request, setCookies: string[]): Request {
  if (setCookies.length === 0) return request;
  const incoming = request.headers.get("cookie") ?? "";
  const parsed = parseCookieHeader(incoming);
  const merged: Record<string, string> = { ...parsed } as Record<string, string>;
  for (const sc of setCookies) {
    const eq = sc.indexOf("=");
    if (eq <= 0) continue;
    const name = sc.slice(0, eq);
    const semi = sc.indexOf(";", eq);
    const value = sc.slice(eq + 1, semi === -1 ? undefined : semi);
    merged[name] = value;
  }
  const newCookieHeader = Object.entries(merged)
    .map(([n, v]) => `${n}=${v}`)
    .join("; ");
  const headers = new Headers(request.headers);
  headers.set("cookie", newCookieHeader);
  return new Request(request, { headers });
}
