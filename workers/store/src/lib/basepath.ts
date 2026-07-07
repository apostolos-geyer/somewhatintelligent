/**
 * The mount-prefix resolver — the ONE place the `/shop` prefix enters app code.
 *
 * The store is vmf-mounted at `/shop` behind bouncer: bouncer STRIPS the mount
 * before the request reaches the worker, so the SERVER always serves at root
 * (`/`, `/products/$slug`, …) and every route definition / `<Link>` / redirect
 * in the app stays prefix-free. The one thing bouncer's HTTP-layer rewrite
 * cannot reach is the hydrated client router's history/link state — so the
 * CLIENT router adopts the mount as a TanStack Router `rewrite` pair
 * (`mountRewrite` below): strip the mount when parsing the browser URL,
 * prepend it when writing to history. Result: the URL bar keeps `/shop`
 * across client-side navigation and hard refreshes, with zero prefixes in
 * app code.
 *
 * The mount is announced at RUNTIME by bouncer's vmf HTML transform
 * (`<meta name="si-mount">`), with the build-time `PUBLIC_BASE` wrangler var
 * (see vite.config.ts CLIENT_VARS) as fallback: `/shop` in
 * staging/production, `/` in local dev-direct (no bouncer, no mount).
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
 * The mount for the current execution side.
 *
 * - Server: always "/" — bouncer already stripped the mount, so the server
 *   router matches the stripped (root) path. A non-root mount here would
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

/**
 * The mount expressed as a TanStack Router `rewrite` pair (browser URL ↔
 * router-internal URL): strip the mount on input, prepend it on output.
 *
 * Why `rewrite` and NOT the `basepath` router option: TanStack Start owns
 * `basepath` — both its server handler (start-server-core
 * createStartHandler) and its client bootstrap (start-client-core
 * hydrateStart) call `router.update({ basepath: process.env.TSS_ROUTER_BASEPATH })`,
 * overriding any basepath set in createRouter. With no plugin-level basepath
 * configured that define is "", which breaks route matching for the mount.
 * `rewrite` is the documented channel for asymmetric-mount cases:
 * router.update() re-composes `options.rewrite` after the basepath rewrite
 * on every update, and Start does not touch it.
 * https://tanstack.com/router/latest/docs/guide/url-rewrites#interaction-with-basepath
 */
export function mountRewrite(mount: string):
  | {
      input: (opts: { url: URL }) => URL;
      output: (opts: { url: URL }) => URL;
    }
  | undefined {
  const m = normalizeBasepath(mount);
  if (m === "/") return undefined;
  return {
    input: ({ url }) => {
      if (url.pathname === m) url.pathname = "/";
      else if (url.pathname.startsWith(`${m}/`)) url.pathname = url.pathname.slice(m.length);
      return url;
    },
    output: ({ url }) => {
      url.pathname = url.pathname === "/" ? m : m + url.pathname;
      return url;
    },
  };
}
