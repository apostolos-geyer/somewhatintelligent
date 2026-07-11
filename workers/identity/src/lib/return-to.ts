// The platform apex we control, carried with a leading dot
// (e.g. `.platform.example.com`). This is the SAME string guestlist uses as
// the cross-subdomain cookie `Domain` (guestlist's AUTH_DOMAIN) and that the
// auth server turns into its `*.{apex}` trustedOrigins
// (`@somewhatintelligent/auth`'s server config). It is set per environment as
// the AUTH_DOMAIN var in identity's wrangler.jsonc (the apex for
// staging/production), with a `.localhost` variant supplied by `.dev.vars` in
// local dev, and exposed to the bundle by the vite `define` allowlist (see
// vite.config.ts CLIENT_VARS).
const AUTH_DOMAIN = import.meta.env.AUTH_DOMAIN as string | undefined;

/**
 * Is `host` inside the platform's controlled domain — the apex itself or any
 * subdomain of it, at any depth? `authDomain` carries a leading dot
 * (e.g. `.platform.example.com`), so the apex is `authDomain` without that
 * dot and every subdomain ends with it (`acme.platform.example.com` →
 * `.platform.example.com`). We own every host under the apex, so this is the
 * whole trust decision — no per-app allowlist to keep in sync.
 */
export function isPlatformHost(host: string, authDomain: string | undefined): boolean {
  if (!authDomain) return false;
  const apex = authDomain.replace(/^\./, "").toLowerCase();
  if (!apex) return false;
  const h = host.toLowerCase();
  return h === apex || h.endsWith(`.${apex}`);
}

/**
 * Env-free core of {@link decodeReturnTo}, exported for unit tests. Validates a
 * post-auth redirect target against the controlled apex `authDomain`. Accepts:
 *   - a same-origin relative path (`/foo`)
 *   - an absolute http(s) URL whose host is the apex or any subdomain of it
 * Returns the value verbatim when valid, `undefined` otherwise.
 */
export function resolveReturnTo(
  value: string | undefined,
  authDomain: string | undefined,
): string | undefined {
  if (!value) return undefined;

  if (value.startsWith("/")) {
    // Guard protocol-relative (`//evil.com`) and UNC-style (`/\evil.com`) paths.
    if (value.startsWith("//") || value.startsWith("/\\")) return undefined;
    return value;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  // `url.hostname` (not `url.host`) so a port never defeats the suffix match and
  // userinfo tricks (`https://trusted@evil.com`) resolve to the real host.
  return isPlatformHost(url.hostname, authDomain) ? value : undefined;
}

/**
 * Validate a post-auth redirect target. This is the open-redirect guard: peer
 * apps hand identity a raw absolute URL via `?returnTo=`, and we round-trip
 * to that exact URL only when it lives under our own apex.
 *
 * The trust rule is "any host we control" — the apex plus every subdomain, in
 * every environment (a `.localhost` apex locally, the real apex in
 * staging/prod). Because we own the whole zone, a new app on a new subdomain
 * is trusted by construction, with nothing to add here. It deliberately mirrors better-auth's
 * `*.{apex}` trustedOrigins so this client-side guard and the server-side
 * callbackURL check (magic-link / social / email-verify) agree.
 */
export function decodeReturnTo(value: string | undefined): string | undefined {
  return resolveReturnTo(value, AUTH_DOMAIN);
}
