import { getRequestLog } from "@si/kit/log";
import { getRequestId } from "@si/kit/request-context";
import { PLATFORM_HEADERS, stampPlatformHeaders, type EnvelopeActor } from "@si/auth";

/**
 * Stamp the platform's privileged header contract on a request before
 * forwarding upstream. Delegates to the shared `stampPlatformHeaders`
 * helper so dev-direct app workers can apply the same contract to
 * self-minted envelopes (see `packages/kit/src/react-start/dev-envelope.ts`).
 *
 * `caller` is always `"bouncer"` at this boundary; the request id comes
 * from the bouncer-side request-context ALS opened at the entry handler.
 */
export function stampUpstreamHeaders(
  request: Request,
  envelope: string,
  actor: EnvelopeActor | null,
): Request {
  return stampPlatformHeaders(request, {
    envelope,
    actor,
    requestId: getRequestId() ?? "",
    caller: "bouncer",
  });
}

/**
 * Strip `x-platform-att` from an upstream response before it leaves
 * bouncer. The envelope is internal-only; it must never leak to a browser.
 * Apps shouldn't echo it (they don't, in practice), but defense in depth.
 */
export function stripPlatformResponseHeaders(response: Response): Response {
  if (!response.headers.has(PLATFORM_HEADERS.att)) return response;
  const headers = new Headers(response.headers);
  headers.delete(PLATFORM_HEADERS.att);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Passthrough dispatch — bouncer is a transparent reverse proxy.
 *
 * The upstream owns its host fully; bouncer forwards the request as-is,
 * captures observability fields (upstream status, content-type,
 * redirect_location on 3xx), and returns the response verbatim. No URL
 * rewriting, no asset rewriting, no cookie path scoping, no Location
 * header rewriting. Header stamping happens upstream of this in
 * `stampUpstreamHeaders`.
 *
 * Used for mounts whose upstream is mount-aware (knows it owns the mount
 * and emits its own canonical URLs) — guestlist's `/api` mount fits this
 * contract. Compare `handleMountedApp` below, used for mount-naive upstreams
 * (e.g. identity's `/account` vmf mount) that need path/asset/redirect/
 * cookie rewriting.
 */
export async function handlePassthrough(request: Request, upstream: Fetcher): Promise<Response> {
  const log = getRequestLog();
  const resp = await upstream.fetch(request);
  log?.add({
    upstream_status: resp.status,
    upstream_content_type: resp.headers.get("content-type") ?? undefined,
  });
  if (resp.status >= 300 && resp.status < 400) {
    log?.add({ redirect_location: resp.headers.get("location") ?? undefined });
  }
  return resp;
}

/**
 * Upstream-app proxy + URL/cookie/redirect rewriting machinery.
 *
 * The host-aware `RouteConfig`/`compileRoutes` surface lives in `./routes.ts`;
 * the entry `fetch` handler + dispatch lives in `./index.ts`. This file owns
 * only `handleMountedApp` and its supporting utilities. `env` is threaded
 * explicitly through `buildAssetPrefixes(envObj)` from the entry handler.
 */

/**
 * Default asset path prefixes that trigger URL rewriting in HTML and CSS.
 *
 * These defaults are always included. Additional custom prefixes can be added
 * via the ASSET_PREFIXES environment variable (JSON array of strings).
 */
const DEFAULT_ASSET_PREFIXES = ["/assets/", "/static/", "/build/", "/_astro/", "/_next", "/fonts/"];

/**
 * Builds the complete list of asset prefixes by merging defaults with custom prefixes from environment.
 *
 * Reads the ASSET_PREFIXES environment variable (optional JSON array) and merges it with
 * the default prefixes. Duplicates are removed, and all prefixes are normalized to start with "/" and end with "/".
 *
 * @param env - Worker env; `ASSET_PREFIXES` is optional, JSON-encoded string.
 * @returns Array of normalized asset prefixes
 */
export function buildAssetPrefixes(env: object): string[] {
  const defaults = [...DEFAULT_ASSET_PREFIXES];

  // Custom prefixes are an optional, JSON-encoded var. `Reflect.get` keeps
  // the dynamic read honest — no cast, no widening of the worker Env type.
  const raw: unknown = Reflect.get(env, "ASSET_PREFIXES");
  if (typeof raw === "string") {
    try {
      const custom: unknown = JSON.parse(raw);
      if (Array.isArray(custom)) {
        // Normalize custom prefixes: ensure they start and end with "/"
        const normalized = custom
          .filter((p): p is string => typeof p === "string" && p.trim() !== "")
          .map((p) => {
            let normalized = p.trim();
            if (!normalized.startsWith("/")) normalized = "/" + normalized;
            if (!normalized.endsWith("/")) normalized = normalized + "/";
            return normalized;
          });
        // Merge with defaults and remove duplicates
        const all = [...defaults, ...normalized];
        return [...new Set(all)]; // Remove duplicates using Set
      }
    } catch (e) {
      // If parsing fails, just use defaults (don't throw - fail gracefully)
      console.warn(
        `Failed to parse ASSET_PREFIXES environment variable: ${e instanceof Error ? e.message : String(e)}. Using defaults only.`,
      );
    }
  }

  return defaults;
}

/* ----------------------------- utilities ----------------------------- */

/**
 * Checks if a path starts with any of the supported asset prefixes.
 * Used to determine if a URL should be rewritten.
 *
 * @param path - Path to check
 * @param assetPrefixes - Array of asset prefixes to check against
 * @returns True if path starts with any of the prefixes
 */
function hasAssetPrefix(path: string, assetPrefixes: string[]): boolean {
  return assetPrefixes.some((p) => path.startsWith(p));
}

/**
 * Normalizes a path string to a consistent format:
 * - Ensures it starts with "/"
 * - Removes trailing "/" (except for root "/")
 *
 * Examples:
 * - "docs" → "/docs"
 * - "/docs/" → "/docs"
 * - "/" → "/"
 */
export function normalizePath(path: string): string {
  if (!path.startsWith("/")) path = "/" + path;
  if (path !== "/" && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

// Route-compile helpers (escapeRegexLiteral, unescapePathLiterals,
// segmentToRegex, computeBaseSpecificity, compilePathExpr) live in
// `./routes.ts`.

/* ---------------------- HTML rewriting + injection ---------------------- */

/**
 * HTMLRewriter handler that rewrites asset URLs in HTML element attributes.
 *
 * Processes elements and rewrites absolute paths in various attributes (href, src, etc.)
 * that match asset prefixes, prepending the mount prefix to maintain correct asset resolution.
 *
 * Special handling:
 * - Root mount ("/") is treated specially - paths are not modified
 * - Only rewrites absolute paths (starting with "/")
 * - Only rewrites paths matching asset prefixes (unless it's a favicon link)
 * - Skips paths already scoped to the mount
 */
class AllAttributesRewriter {
  constructor(
    private mount: string,
    private assetPrefixes: string[],
  ) {
    this.mount = normalizePath(mount);
  }

  /**
   * Prepends the mount prefix to a path, handling root mount ("/") specially.
   * When mount is "/", returns the path unchanged (treating root as no prefix).
   */
  private prependMount(path: string): string {
    return this.mount === "/" ? path : this.mount + path;
  }

  /**
   * Checks if a path is already scoped to the mount prefix.
   * When mount is "/", all absolute paths are considered scoped (no rewriting needed).
   */
  private isScopedToMount(path: string): boolean {
    // When mount is "/", all absolute paths are already at root, so they're "scoped"
    // and don't need rewriting (prependMount would return them unchanged anyway)
    if (this.mount === "/") return true;
    return path.startsWith(this.mount + "/");
  }

  element(el: Element) {
    const tagName = el.tagName?.toLowerCase();

    // Favicon/link icon rewrite even if it doesn't match asset prefixes (always rewrite icons).
    if (tagName === "link") {
      const rel = el.getAttribute("rel")?.toLowerCase();
      const href = el.getAttribute("href");
      if (rel && (rel.includes("icon") || rel.includes("shortcut")) && href) {
        if (href.startsWith("/") && !this.isScopedToMount(href)) {
          el.setAttribute("href", this.prependMount(href));
        }
      }
    }

    const commonAttrs = [
      "href",
      "src",
      "poster",
      "content",
      "action",
      "cite",
      "formaction",
      "manifest",
      "ping",
      "archive",
      "code",
      "codebase",
      "data",
      "url",
      "srcset",

      // data attrs
      "data-src",
      "data-href",
      "data-url",
      "data-srcset",
      "data-background",
      "data-image",
      "data-link",
      "data-poster",
      "data-video",
      "data-audio",

      // framework-ish
      "component-url",
      "astro-component-url",
      "sveltekit-url",
      "renderer-url",

      // misc
      "background",
      "xlink:href",
    ];

    for (const attrName of commonAttrs) {
      const val = el.getAttribute(attrName);
      if (!val) continue;

      // srcset contains multiple URLs
      if (attrName === "srcset") {
        const rewritten = val
          .split(",")
          .map((src) => {
            const trimmed = src.trim();
            const parts = trimmed.split(/\s+/);
            const url = parts[0] ?? "";

            if (
              url.startsWith("/") &&
              !this.isScopedToMount(url) &&
              hasAssetPrefix(url, this.assetPrefixes)
            ) {
              return this.prependMount(url) + (parts[1] ? " " + parts[1] : "");
            }
            return trimmed;
          })
          .join(", ");

        if (rewritten !== val) el.setAttribute(attrName, rewritten);
        continue;
      }

      // absolute-only
      if (!val.startsWith("/")) continue;

      // already scoped
      if (this.isScopedToMount(val)) continue;

      // asset-only
      if (!hasAssetPrefix(val, this.assetPrefixes)) continue;

      el.setAttribute(attrName, this.prependMount(val));
    }
  }
}

/**
 * HTMLRewriter handler that injects CSS for smooth view transitions.
 *
 * Injects CSS into the <head> element to enable browser-native view transitions
 * when navigating between microfrontends. The CSS is only injected once per response.
 */
class SmoothTransitionsInjector {
  private injected = false;

  element(el: Element) {
    if (this.injected) return;
    this.injected = true;

    const css = `@supports (view-transition-name: none) {
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation-duration: 0.3s;
    animation-timing-function: ease-in-out;
  }
  main { view-transition-name: main-content; }
  nav { view-transition-name: navigation; }
}`;

    el.append(`<style>${css}</style>`, { html: true });
  }
}

/**
 * HTMLRewriter handler that announces the vmf mount to the hydrated client.
 *
 * vmf strips the mount server-side (apps serve at their own root, prefix-free)
 * and rewrites HTTP-layer artifacts, but the one thing it cannot reach is the
 * SPA router's client-side history: after hydration the browser URL carries
 * the mount while the app's router thinks in root paths. This meta tag is the
 * runtime contract that closes that gap — each mounted app's router reads
 * `<meta name="si-mount">` at hydration and adopts it as its client basepath.
 * No build-time configuration, correct for any mount, absent in dev-direct
 * (no bouncer → no meta → basepath "/").
 */
class MountMetaInjector {
  private injected = false;

  constructor(private mount: string) {}

  element(el: Element) {
    if (this.injected || this.mount === "/" || this.mount === "") return;
    this.injected = true;
    el.append(`<meta name="si-mount" content="${this.mount}">`, { html: true });
  }
}

/**
 * HTMLRewriter handler that injects speculation rules for prefetching routes.
 *
 * Injects a <script type="speculationrules"> element into the <head> to enable
 * browser-native prefetching via the Speculation Rules API. This is more efficient
 * than JavaScript-based fetching and respects user preferences.
 *
 * The script is only injected once per response.
 */
class SpeculationRulesInjector {
  private injected = false;
  private rulesJson: string;

  constructor(preloadMounts: string[]) {
    this.rulesJson = generateSpeculationRules(preloadMounts);
  }

  element(el: Element) {
    if (this.injected) return;
    this.injected = true;

    // Inject speculation rules script into head
    // Note: CSP may need 'inline-speculation-rules' source or hash/nonce
    el.append(`<script type="speculationrules">${this.rulesJson}</script>`, {
      html: true,
    });
  }
}

/**
 * HTMLRewriter handler that injects a fallback preload script for non-Chromium browsers.
 *
 * Injects a <script> tag that loads the `__mf-preload.js` script, which uses fetch()
 * to preload routes. This is used as a fallback for browsers that don't support
 * the Speculation Rules API (Firefox, Safari).
 *
 * The script is only injected once per response, before </body>.
 */
class PreloadScriptInjector {
  private injected = false;
  private scriptPath: string;

  constructor(mountActual: string) {
    // Special handling for root mount to avoid "//__mf-preload.js"
    this.scriptPath = mountActual === "/" ? "/__mf-preload.js" : `${mountActual}/__mf-preload.js`;
  }

  element(el: Element) {
    if (this.injected) return;
    this.injected = true;

    // Inject script tag before closing body tag
    const tag = `<script src="${this.scriptPath}" defer></script>`;
    el.append(tag, { html: true });
  }
}

/* ----------------------- headers / redirects / cookies ----------------------- */

/**
 * Creates a copy of headers with transformation-incompatible headers removed.
 *
 * Removes headers that become invalid when response body is transformed:
 * - content-length: Body size changes after rewriting
 * - etag: Content changes, so ETag is invalid
 * - content-encoding: Compression is removed when reading body as text
 */
function cloneHeadersForTransform(original: Headers): Headers {
  const headers = new Headers(original);
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("content-encoding");
  return headers;
}

/**
 * Rewrites redirect Location headers to include the mount prefix.
 *
 * When an upstream service redirects to an absolute path on the same origin,
 * the path is rewritten to include the mount prefix so the redirect points to
 * the correct path within the mounted microfrontend.
 *
 * @param location - Original Location header value
 * @param mount - Mount prefix to prepend (e.g., "/docs")
 * @param requestUrl - Original request URL for resolving relative URLs
 * @returns Rewritten Location header value
 */
function rewriteLocation(location: string, mount: string, requestUrl: URL): string {
  mount = normalizePath(mount);
  try {
    const url = new URL(location, requestUrl.origin);

    // Same-origin redirects: prepend the mount prefix (unless root) and emit
    // a *relative* Location (`pathname + search + hash`) so the browser
    // resolves it against the public origin it navigated from, rather than
    // `requestUrl.origin` (workerd's local bind address under `wrangler dev`).
    if (url.origin === requestUrl.origin && url.pathname.startsWith("/")) {
      const newPath = mount === "/" ? url.pathname : mount + url.pathname;
      return newPath + url.search + url.hash;
    }
  } catch {
    // ignore invalid URLs
  }
  return location;
}

/**
 * Rewrites Set-Cookie headers to scope cookie paths to the mount prefix.
 *
 * Cookies with Path=/ are rewritten to Path=/mount/ to prevent cookie collisions
 * between different microfrontends mounted at different paths.
 *
 * Uses Headers.getSetCookie() which is available in Cloudflare Workers runtime.
 *
 * @param headers - Headers object containing Set-Cookie headers
 * @param mount - Mount prefix to use for cookie path (e.g., "/docs")
 */
function rewriteSetCookie(headers: Headers, mount: string) {
  mount = normalizePath(mount);

  const cookies = headers.getSetCookie();
  if (cookies.length === 0) return;

  headers.delete("Set-Cookie");
  for (const cookie of cookies) {
    if (/;\s*Path=\//i.test(cookie)) {
      // If mount is "/", keep Path=/ (root)
      const newPath = mount === "/" ? "/" : `${mount}/`;
      headers.append("Set-Cookie", cookie.replace(/;\s*Path=\//i, `; Path=${newPath}`));
    } else {
      headers.append("Set-Cookie", cookie);
    }
  }
}

/* --------------------------- preload script endpoint --------------------------- */

/**
 * Generates a preload script that fetches specified routes after DOM loads.
 *
 * This script is served at `${mount}/__mf-preload.js` and is injected into HTML
 * responses as an external script tag. Using an external script is more CSP-friendly
 * than inline JavaScript.
 *
 * The script preloads routes by making GET requests with same-origin credentials,
 * helping to warm up routes for faster navigation.
 *
 * **Important:** Preload targets must be static mount roots (no dynamic parameters),
 * otherwise we cannot determine the concrete mount paths to fetch.
 *
 * @param preloadMounts - Array of mount paths to preload (e.g., ["/app1", "/app2"])
 * @returns Response containing the preload script
 */
function getPreloadScriptResponse(preloadMounts: string[]): Response {
  const json = JSON.stringify(preloadMounts);
  const js =
    `(()=>{const routes=${json};` +
    `const run=()=>{for(const p of routes){fetch(p,{method:"GET",credentials:"same-origin",cache:"default"}).catch(()=>{});}};` +
    `if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",run,{once:true});}else{run();}` +
    `})();`;

  return new Response(js, {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

/* --------------------------- speculation rules --------------------------- */

/**
 * Detects if the browser is Chromium-based (Chrome, Edge, etc.) from User-Agent.
 *
 * Chromium-based browsers support the Speculation Rules API, while others
 * (Firefox, Safari) do not yet support it and need the fallback fetch script.
 *
 * @param userAgent - User-Agent header string from the request
 * @returns True if the browser is Chromium-based
 */
function isChromiumBrowser(userAgent: string): boolean {
  // Chromium-based browsers include: Chrome, Edge, Opera, Brave, etc.
  // They typically have "Chrome" in the User-Agent (even Edge does)
  // but not "Firefox" or "Safari" (without Chrome)
  if (!userAgent) return false;

  const ua = userAgent.toLowerCase();
  // Check for Chromium indicators
  const hasChrome = ua.includes("chrome");
  const hasEdge = ua.includes("edg/"); // Edge uses "Edg/" not "Edge"
  const hasOpera = ua.includes("opr/");
  const hasBrave = ua.includes("brave");

  // Exclude Firefox and Safari (which don't support Speculation Rules yet)
  const isFirefox = ua.includes("firefox");
  const isSafari = ua.includes("safari") && !ua.includes("chrome");

  return (hasChrome || hasEdge || hasOpera || hasBrave) && !isFirefox && !isSafari;
}

/**
 * Generates speculation rules JSON for prefetching routes.
 *
 * Uses the Speculation Rules API to enable browser-native prefetching of routes.
 * This is more efficient than JavaScript-based fetching as it:
 * - Respects user preferences (battery saver, data saver)
 * - Works for cross-site navigations (with proper configuration)
 * - Doesn't get blocked by Cache-Control headers
 * - Automatically manages priority
 * - Stores prefetched resources in a per-document in-memory cache
 *
 * For same-origin routes (which is the case for all microfrontend routes),
 * we use simple prefetch rules without cross-origin requirements.
 *
 * @param preloadMounts - Array of mount paths to prefetch (e.g., ["/app1", "/app2"])
 * @returns JSON string containing speculation rules
 */
function generateSpeculationRules(preloadMounts: string[]): string {
  const rules = {
    prefetch: [
      {
        urls: preloadMounts,
        // For same-origin routes, we don't need requires or referrer_policy
        // The browser will use same-origin credentials automatically
      },
    ],
  };
  return JSON.stringify(rules);
}

/* ------------------------------ main proxy handler ------------------------------ */

interface MountedAppOptions {
  smoothTransitions?: boolean;
  preloadStaticMounts?: string[];
}

/**
 * Strips the matched mount prefix from the path before forwarding to upstream.
 * The upstream service expects paths relative to its mount point.
 * Example: /docs/about -> /about (when mount is /docs)
 * If mount is "/" (root), the path passes through as-is without stripping.
 */
function stripMountPrefix(forwardUrl: URL, mountActual: string): void {
  if (mountActual === "/") return;
  if (forwardUrl.pathname === mountActual) {
    forwardUrl.pathname = "/";
  } else if (forwardUrl.pathname.startsWith(mountActual + "/")) {
    forwardUrl.pathname = forwardUrl.pathname.slice(mountActual.length) || "/";
  }
}

/**
 * Records upstream status/content-type on the request log; on 5xx also
 * captures a body preview (from a clone — the original stays readable).
 */
async function logUpstreamResponse(upstreamResp: Response, contentType: string): Promise<void> {
  const log = getRequestLog();
  log?.add({
    upstream_status: upstreamResp.status,
    upstream_content_type: contentType || undefined,
  });
  if (upstreamResp.status >= 500) {
    const clone = upstreamResp.clone();
    const body = await clone.text().catch(() => "<unreadable body>");
    log?.add({ upstream_body_preview: body.slice(0, 512) });
  }
}

/**
 * Builds a redirect response with the Location header rewritten under the
 * mount and Set-Cookie paths scoped to it. Mutates `headers`.
 */
function buildRedirectResponse(
  upstreamResp: Response,
  headers: Headers,
  mountActual: string,
  requestUrl: URL,
): Response {
  const loc = headers.get("location");
  if (loc) headers.set("location", rewriteLocation(loc, mountActual, requestUrl));
  rewriteSetCookie(headers, mountActual);

  getRequestLog()?.add({ redirect_location: headers.get("location") ?? undefined });

  return new Response(null, { status: upstreamResp.status, headers });
}

/**
 * Assembles the HTMLRewriter pipeline: asset-URL rewriting on all elements,
 * optional view-transition CSS, and the browser-appropriate preload
 * mechanism (Speculation Rules for Chromium, fetch-script fallback for
 * Firefox/Safari).
 */
function buildHtmlRewriter(
  request: Request,
  mountActual: string,
  assetPrefixes: string[],
  options?: MountedAppOptions,
): HTMLRewriter {
  const rewriter = new HTMLRewriter().on(
    "*",
    new AllAttributesRewriter(mountActual, assetPrefixes),
  );
  rewriter.on("head", new MountMetaInjector(mountActual));
  if (options?.smoothTransitions) rewriter.on("head", new SmoothTransitionsInjector());

  if (options?.preloadStaticMounts?.length) {
    const userAgent = request.headers.get("user-agent") || "";
    if (isChromiumBrowser(userAgent)) {
      rewriter.on("head", new SpeculationRulesInjector(options.preloadStaticMounts));
    } else {
      rewriter.on("body", new PreloadScriptInjector(mountActual));
    }
  }
  return rewriter;
}

async function transformHtmlResponse(
  request: Request,
  upstreamResp: Response,
  headers: Headers,
  mountActual: string,
  assetPrefixes: string[],
  options?: MountedAppOptions,
): Promise<Response> {
  const htmlText = await upstreamResp.text();

  const headersOut = cloneHeadersForTransform(headers);
  rewriteSetCookie(headersOut, mountActual);

  return buildHtmlRewriter(request, mountActual, assetPrefixes, options).transform(
    new Response(htmlText, {
      status: upstreamResp.status,
      statusText: upstreamResp.statusText,
      headers: headersOut,
    }),
  );
}

/**
 * Transforms a CSS response: rewrites url() references with absolute asset
 * paths to include the mount prefix. The prefix regex is built dynamically
 * from `assetPrefixes`.
 */
async function transformCssResponse(
  upstreamResp: Response,
  headers: Headers,
  mountActual: string,
  assetPrefixes: string[],
): Promise<Response> {
  const cssText = await upstreamResp.text();
  const headersOut = cloneHeadersForTransform(headers);
  rewriteSetCookie(headersOut, mountActual);

  // Special handling for root mount: don't add prefix.
  const cssMountPrefix = mountActual === "/" ? "" : mountActual;

  // Build regex pattern from asset prefixes (escape special regex chars, join with |).
  // Example: /assets/|/static/|/build/ becomes (?:/assets/|/static/|/build/)
  const prefixPattern = assetPrefixes
    .map((p) => p.slice(1, -1)) // Remove leading "/" and trailing "/" for regex
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) // Escape regex special chars
    .join("|");
  const regex = new RegExp(`url\\(\\s*(['"]?)(/(?:${prefixPattern})/)`, "g");

  // Match: url('...'), url("..."), or url(...) with absolute asset paths.
  const rewrittenCss = cssText.replace(regex, `url($1${cssMountPrefix}$2`);

  return new Response(rewrittenCss, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers: headersOut,
  });
}

/**
 * Handles a request for a mounted microfrontend.
 *
 * This is the core request processing function that:
 * 1. Strips the mount prefix from the request path before forwarding upstream
 * 2. Transforms the response (HTML/CSS rewriting, redirect/cookie handling)
 * 3. Optionally injects speculation rules and view transition CSS
 *
 * @param request - Original incoming request
 * @param upstream - Fetcher for the service binding (upstream microfrontend)
 * @param mountActual - The concrete matched mount path (e.g., "/docs" or "/acme" for "/:tenant")
 * @param assetPrefixes - Array of asset prefixes to use for URL rewriting
 * @param options - Optional configuration for response transformation
 * @returns Transformed response
 */
export async function handleMountedApp(
  request: Request,
  upstream: Fetcher,
  mountActual: string,
  assetPrefixes: string[],
  options?: MountedAppOptions,
): Promise<Response> {
  mountActual = normalizePath(mountActual);

  const forwardUrl = new URL(request.url);
  stripMountPrefix(forwardUrl, mountActual);

  // Serve preload script from the router itself (not from upstream service).
  // This script is used as a fallback for browsers that don't support Speculation Rules API.
  // Must be checked BEFORE forwarding to upstream to intercept the request.
  if (options?.preloadStaticMounts?.length && forwardUrl.pathname === "/__mf-preload.js") {
    return getPreloadScriptResponse(options.preloadStaticMounts);
  }

  // Correlation headers (cf-request-id, x-caller-app) are stamped at the
  // bouncer entry by `stampUpstreamHeaders` so both passthrough and vmf
  // dispatch paths get them; `request` here already carries them.
  const upstreamResp = await upstream.fetch(new Request(forwardUrl.toString(), request));
  const headers = new Headers(upstreamResp.headers);
  const contentType = headers.get("content-type") || "";

  await logUpstreamResponse(upstreamResp, contentType);

  if (upstreamResp.status >= 300 && upstreamResp.status < 400) {
    return buildRedirectResponse(upstreamResp, headers, mountActual, new URL(request.url));
  }

  if (contentType.includes("text/html")) {
    return transformHtmlResponse(
      request,
      upstreamResp,
      headers,
      mountActual,
      assetPrefixes,
      options,
    );
  }

  if (contentType.includes("text/css")) {
    return transformCssResponse(upstreamResp, headers, mountActual, assetPrefixes);
  }

  // Passthrough for all other content types (JSON, images, fonts, etc.).
  // Only rewrite cookies - don't modify the body.
  rewriteSetCookie(headers, mountActual);
  return new Response(upstreamResp.body, {
    status: upstreamResp.status,
    statusText: upstreamResp.statusText,
    headers,
  });
}

// `buildRoutes` and the `default { fetch }` export are owned by
// `./routes.ts` (compileRoutes) and `./index.ts` (the entry handler).
