/**
 * The mount-prefix resolver — the ONE place the `/account` mount enters app code.
 *
 * Identity is vmf-mounted at `/account` behind bouncer: bouncer STRIPS the mount
 * before the request reaches the worker, so the SERVER always serves at root
 * (`/`, `/products/$slug`, …) and every route definition / `<Link>` / redirect
 * in the app stays prefix-free. The one thing bouncer's HTTP-layer rewrite
 * cannot reach is the hydrated client router's history/link state — so the
 * CLIENT router adopts `basepath = PUBLIC_BASE` (the mount), which makes
 * TanStack Router natively prepend the mount to the browser URL on navigation
 * and strip it when matching. Result: the URL bar keeps `/shop` across
 * client-side navigation and hard refreshes, with zero prefixes in app code.
 *
 * `PUBLIC_BASE` is injected into the client bundle from a single wrangler var
 * (see vite.config.ts CLIENT_VARS): absent for identity (the runtime
 * si-mount meta is the only source); `/` in local dev-direct.
 */

/** Normalize a raw base to a leading-slash, no-trailing-slash form ("/" stays "/"). */
export function normalizeBasepath(raw: string | undefined | null): string {
  if (raw == null) return "/";
  let b = raw.trim();
  if (b === "" || b === "/") return "/";
  if (!b.startsWith("/")) b = `/${b}`;
  while (b.length > 1 && b.endsWith("/")) b = b.slice(0, -1);
  return b;
}

/**
 * The router basepath for the current execution side.
 *
 * - Server: always "/" — bouncer already stripped the mount, so the server
 *   router matches the stripped (root) path. A non-root basepath here would
 *   fail to match the stripped path.
 * - Client: the mount announced at RUNTIME by bouncer's vmf HTML transform
 *   (`<meta name="si-mount">` — see bouncer's MountMetaInjector) wins, then
 *   the build-time PUBLIC_BASE fallback, then "/". The runtime meta is the
 *   authoritative source: it needs no build-time config and is correct for
 *   whatever mount bouncer actually served this document under.
 */
export function resolveBasepath(opts: {
  isServer: boolean;
  publicBase: string | undefined | null;
  mountMeta?: string | undefined | null;
}): string {
  if (opts.isServer) return "/";
  const meta = opts.mountMeta?.trim();
  if (meta) return normalizeBasepath(meta);
  return normalizeBasepath(opts.publicBase);
}

/** Reads bouncer's vmf mount announcement from the served document (client only). */
export function readMountMeta(): string | null {
  if (typeof document === "undefined") return null;
  return document.querySelector('meta[name="si-mount"]')?.getAttribute("content") ?? null;
}
