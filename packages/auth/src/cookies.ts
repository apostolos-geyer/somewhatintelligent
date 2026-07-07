import { parse } from "cookie-es";

/**
 * Parse a request's `Cookie` header into the `{name, value}[]` shape Better
 * Auth's cookie adapter expects. Used wherever a `createGuestlistClient`
 * needs to read cookies straight from an inbound `Request` (worker-entry
 * paths that run before TSS captures the H3 context — bouncer's session
 * resolver, an app's dev-envelope stamper).
 */
export function parseRequestCookies(request: Request): Array<{ name: string; value: string }> {
  return Object.entries(parse(request.headers.get("cookie") ?? "")).map(([name, value]) => ({
    name,
    value: value ?? "",
  }));
}
