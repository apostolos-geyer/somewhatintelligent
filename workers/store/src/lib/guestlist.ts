import { env } from "cloudflare:workers";
import { createGuestlistClient } from "@somewhatintelligent/guestlist/client";
import { parseRequestCookies } from "@somewhatintelligent/auth";

export const guestlistFetcher = () => env.GUESTLIST.fetch.bind(env.GUESTLIST);

/**
 * Request-scoped guestlist client: store has no TSS request context to read
 * cookies from ambiently, so the cookie adapter reads straight off the given
 * Request (mirrors the bouncer/dev-envelope pattern — the client is cheap,
 * built fresh per call).
 */
export function getGuestlist(request: Request) {
  const cookies = parseRequestCookies(request);
  return createGuestlistClient({
    baseURL: env.STORE_URL ?? "https://guestlist-service.localhost",
    callerApp: "store",
    fetchOptions: { customFetchImpl: guestlistFetcher() },
    cookies: { getAll: () => cookies, setAll: () => {} },
  });
}
