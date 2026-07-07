/**
 * Brand-addressing STRATEGY — how a request maps to a brand slug, selected at
 * BUILD time by the `BRAND_RESOLUTION` var (injected into `import.meta.env` via
 * vite `define`, see `vite.config.ts` CLIENT_VARS). Two modes:
 *
 *  - `subdomain` (dev + production): the brand is the host's leftmost label
 *    (`acme.sprout.<apex>` → `acme`). One worker, infinite skins, a brand is a
 *    DNS wildcard + a row of data. This is the canonical topology.
 *  - `path` (staging): every brand lives on the SINGLE already-provisioned host
 *    (`sprout-staging.<apex>`); the brand is selected by visiting `/b/<slug>`,
 *    which sets the `sprout_brand` cookie. The resolver then reads that cookie.
 *    This needs NO per-brand DNS / wildcard cert — the whole environment is one
 *    host — at the cost of a staging≠prod addressing divergence. It is the
 *    self-contained way to demo multi-brand before the prod wildcard zone lands.
 *
 * Why a cookie and not the URL path: brand resolution must work for SERVER
 * FUNCTION calls too, and a server-fn POST hits `/_serverFn/...` — the page path
 * (`/b/acme/...`) is GONE by then, but cookies ride every request to the host.
 * The cookie is the one discriminator that survives both page loads and the
 * server-fn round-trip, exactly like the host does in subdomain mode.
 *
 * This module is PURE (no env/D1/React) so the strategy table is unit-testable,
 * mirroring `brand.ts`. The slug it returns is fed to `resolveBrandBySlug`
 * (server) — a slug is NEVER trusted for tenancy; it only picks the public SKIN.
 */
import { slugFromHost } from "@/lib/brand";

export type BrandResolutionMode = "subdomain" | "path";

/** Build-injected (vite `define`); defaults to the canonical subdomain topology. */
export const BRAND_RESOLUTION_MODE: BrandResolutionMode =
  import.meta.env.BRAND_RESOLUTION === "path" ? "path" : "subdomain";

/** Host-scoped cookie carrying the selected brand slug in `path` mode. */
export const BRAND_COOKIE = "sprout_brand";

/** The request facts a strategy may read: the routing host + the brand cookie. */
export interface BrandRequestInfo {
  host: string | null;
  brandCookie: string | null;
}

/**
 * The strategy table the user asked for: `mode → (request) → brand slug`. Each
 * returns the slug (or null = apex/Hub / unselected). `subdomain` reads the host
 * label; `path` reads the cookie the `/b/<slug>` entry route set.
 */
export const brandSlugResolvers: Record<
  BrandResolutionMode,
  (info: BrandRequestInfo) => string | null
> = {
  subdomain: ({ host }) => slugFromHost(host),
  path: ({ brandCookie }) => (brandCookie && brandCookie.length > 0 ? brandCookie : null),
};

/** Resolve the brand slug for a request under the active build-time strategy. */
export function resolveBrandSlug(info: BrandRequestInfo): string | null {
  return brandSlugResolvers[BRAND_RESOLUTION_MODE](info);
}

/**
 * Build the Hub→portal entry URL for a slug, per mode. `apexOrigin` is
 * `SPROUT_URL` (the apex/single-host origin); `path` is an optional in-portal
 * deep link (e.g. `/requests`, `/?section=contact`). Subdomain mode prepends the
 * slug as a label (`acme.<apex><path>`); path mode targets the `/b/<slug>` entry
 * on the same host, threading a non-root `path` as `?next=` so the entry route
 * can land the user on the deep link AFTER it sets the brand cookie. Mirrored on
 * the server (`hub.functions`, `notifications.functions`) so the two modes never
 * drift.
 */
export function portalEntryUrl(apexOrigin: string, slug: string, path = "/"): string {
  if (BRAND_RESOLUTION_MODE === "path") {
    const base = `${apexOrigin.replace(/\/$/, "")}/b/${slug}`;
    return path && path !== "/" ? `${base}?next=${encodeURIComponent(path)}` : base;
  }
  const u = new URL(apexOrigin);
  u.hostname = `${slug}.${u.hostname}`;
  return new URL(path, u.origin).toString();
}
