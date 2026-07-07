// Path-syntax and regex compilation lifted from the Cloudflare microfrontend
// template. Optional `host` is the bouncer extension: when present, restricts
// the route to a specific hostname (or `*.platform.example` single-label wildcard).
// `host` accepts a string or an array — array entries are expanded at compile
// time into one CompiledRoute per host so the matcher stays a single sweep.
// When absent, the route matches any host (template behavior).
// Specificity: exact host > wildcard host > no host.
//
// The wire schema is validated by arktype: misconfiguration is a boot failure
// surfaced with a precise field path (e.g. `routes[3].binding must be a
// string`) rather than the prior hand-rolled "Invalid route entry" error.
import { type } from "arktype";

// `passthrough` (default): one upstream owns this MOUNT fully — bouncer is a
// transparent reverse proxy. No URL/asset/cookie/redirect rewriting.
// `vmf`: one or more mount-naive upstreams under this MOUNT — bouncer runs
// the full Cloudflare-microfrontend transformation pipeline (path strip,
// asset-prefix rewriting, Location/cookie path scoping, preload injection).
// The mounted app serves at its OWN root (bouncer strips the mount inbound)
// and stays entirely prefix-free server-side; bouncer rewrites the outbound
// artifacts (asset paths, Location, Set-Cookie paths) back under the mount.
// The identity (`/account`) and store (`/shop`) SPAs are mounted this way.
// The one thing vmf cannot rewrite is a hydrated client router's history/link
// state — so each SPA closes that gap itself with a CLIENT-ONLY router
// `basepath` fed by a single `PUBLIC_BASE` config value (see decision #14 in
// docs/exec-plans/active/0001-greenfield-bootstrap.md).
// `redirect`: bouncer answers directly with a Location redirect — no
// upstream `binding` involved at all.
// Mode is fixed per (host, mount) — e.g. one host can freely run `/api` in
// passthrough and `/account` in vmf, since dispatch (index.ts) already picks
// mode per matched route and `handleMountedApp` only ever rewrites the
// response for the mount it matched. What's rejected is the SAME mount on
// the SAME host declared in two different modes — see compileRoutes' mode-
// consistency check. `redirect` is exempt even from that: it never touches
// the passthrough/vmf asset-handling contract the rule protects, so it's
// free to coexist with either mode on the same mount too.
const RouteModeSchema = type("'passthrough' | 'vmf'");
const RedirectStatusSchema = type("301 | 302 | 307 | 308");

// Passthrough/vmf routes proxy to an upstream `binding`; redirect routes
// answer directly with a Location header and carry no binding at all.
const ProxyRouteConfigSchema = type({
  binding: "string > 0",
  "host?": "string | string[]",
  path: "string > 0",
  "preload?": "boolean",
  "mode?": RouteModeSchema,
});

const RedirectRouteConfigSchema = type({
  "host?": "string | string[]",
  path: "string > 0",
  mode: "'redirect'",
  to: "string > 0",
  "status?": RedirectStatusSchema,
});

const RouteConfigSchema = ProxyRouteConfigSchema.or(RedirectRouteConfigSchema);

const RoutesConfigSchema = type({
  "smoothTransitions?": "boolean",
  routes: RouteConfigSchema.array(),
});

type RouteMode = typeof RouteModeSchema.infer | "redirect";
type RedirectStatus = typeof RedirectStatusSchema.infer;

export type CompiledRoute = {
  expr: string;
  bindingName?: string;
  host?: string;
  hostIsWildcard: boolean;
  hostWildcardTail?: string;
  preload?: boolean;
  mode: RouteMode;
  redirectTo?: string;
  redirectStatus?: RedirectStatus;
  re: RegExp;
  isStaticMount: boolean;
  staticMount?: string;
  baseSpecificity: number;
};

function normalizePath(p: string): string {
  if (!p.startsWith("/")) p = "/" + p;
  if (p !== "/" && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function escapeRegexLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapePathLiterals(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/**
 * Convert a single path-segment expression to a regex pattern.
 * Supports literals, `:name`, `:name(pattern)`, embedded params, and
 * backslash-escaped literals. Throws on unclosed `(...)`.
 */
function segmentToRegex(segmentExpr: string): string {
  let out = "";
  let i = 0;
  while (i < segmentExpr.length) {
    const ch = segmentExpr[i];
    if (ch === "\\") {
      if (i + 1 < segmentExpr.length) {
        out += escapeRegexLiteral(segmentExpr[i + 1]!);
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (ch === ":") {
      const nameMatch = segmentExpr.slice(i).match(/^:([A-Za-z0-9_]+)/);
      if (!nameMatch) throw new Error(`Invalid param in segment: "${segmentExpr}"`);
      const name = nameMatch[1]!;
      i += 1 + name.length;
      if (segmentExpr[i] === "(") {
        let depth = 0;
        let j = i;
        for (; j < segmentExpr.length; j++) {
          const c = segmentExpr[j]!;
          if (c === "\\" && j + 1 < segmentExpr.length) {
            j++;
            continue;
          }
          if (c === "(") depth++;
          if (c === ")") {
            depth--;
            if (depth === 0) break;
          }
        }
        if (j >= segmentExpr.length) {
          throw new Error(`Unclosed (...) in segment: "${segmentExpr}"`);
        }
        const inner = segmentExpr.slice(i + 1, j);
        out += `(${unescapePathLiterals(inner)})`;
        i = j + 1;
      } else {
        out += "([^/]+)";
      }
      continue;
    }
    out += escapeRegexLiteral(ch!);
    i++;
  }
  return out;
}

function computeBaseSpecificity(expr: string): number {
  const idx = expr.indexOf(":");
  const prefix = idx === -1 ? expr : expr.slice(0, idx);
  return prefix.length;
}

function compilePathExpr(exprRaw: string): {
  re: RegExp;
  isStaticMount: boolean;
  staticMount?: string;
} {
  const expr = normalizePath(exprRaw.trim());
  const isStaticMount =
    !expr.includes(":") && !expr.includes("(") && !expr.includes(")") && !expr.includes("\\");
  if (isStaticMount) {
    const re = new RegExp(`^(${escapeRegexLiteral(expr)})(?:/.*)?$`);
    return { re, isStaticMount: true, staticMount: expr };
  }
  const parts = expr.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  const mStarPlus = last.match(/^:([A-Za-z0-9_]+)([*+])$/);
  let mountPattern = "^/";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (mStarPlus && i === parts.length - 1) break;
    mountPattern += segmentToRegex(part);
    if (i < parts.length - 1 && !(mStarPlus && i === parts.length - 2)) {
      mountPattern += "/";
    }
  }
  mountPattern = mountPattern.replace(/\/$/, "");
  if (mStarPlus) {
    const op = mStarPlus[2];
    if (op === "*") return { re: new RegExp(`^(${mountPattern})(?:/.*)?$`), isStaticMount: false };
    return { re: new RegExp(`^(${mountPattern})/.+$`), isStaticMount: false };
  }
  return { re: new RegExp(`^(${mountPattern})(?:/.*)?$`), isStaticMount: false };
}

// Throws on malformed config — misconfiguration is a boot failure, not per-request.
export function compileRoutes(input: unknown): {
  routes: CompiledRoute[];
  smoothTransitions?: boolean;
} {
  const parsed = RoutesConfigSchema(input);
  if (parsed instanceof type.errors) {
    throw new Error(`ROUTES validation failed: ${parsed.summary}`);
  }
  const compiled: CompiledRoute[] = [];
  for (const rec of parsed.routes) {
    const expr = normalizePath(rec.path);
    const { re, isStaticMount, staticMount } = compilePathExpr(expr);
    const hosts: Array<string | undefined> = Array.isArray(rec.host)
      ? rec.host.length === 0
        ? [undefined]
        : rec.host
      : [rec.host];
    for (const host of hosts) {
      const hostIsWildcard = !!host?.startsWith("*.");
      const shared = {
        expr,
        host,
        hostIsWildcard,
        hostWildcardTail: hostIsWildcard ? host!.slice(1) : undefined,
        re,
        isStaticMount,
        staticMount,
        baseSpecificity: computeBaseSpecificity(expr),
      };
      if (rec.mode === "redirect") {
        compiled.push({
          ...shared,
          mode: "redirect",
          redirectTo: rec.to,
          redirectStatus: rec.status ?? 308,
        });
      } else {
        compiled.push({
          ...shared,
          bindingName: rec.binding,
          preload: rec.preload,
          mode: rec.mode ?? "passthrough",
        });
      }
    }
  }
  // Per-(host, mount) mode consistency: the SAME mount on the SAME host can't
  // be declared in two different modes — which one would actually dispatch is
  // ambiguous and almost certainly a config bug, so reject at boot. This is
  // narrower than the original per-HOST rule: passthrough and vmf now legally
  // coexist on one host as long as they own DIFFERENT mounts (e.g. `/api`
  // passthrough + `/account` vmf on the same apex) — dispatch in index.ts
  // already picks per-route mode at match time, so there's no cross-mount
  // asset/cookie/redirect-rewriting conflict for `handleMountedApp` to worry
  // about; it only ever touches the response for the mount it matched.
  // `redirect` is exempt entirely — it never touches the passthrough/vmf
  // asset-handling contract this rule protects, so it's free to coexist with
  // either mode on the same mount too. Wildcard hosts are checked separately
  // from exact hosts since they're distinct match tiers (same as before).
  const mountModes = new Map<string, RouteMode>();
  for (const r of compiled) {
    if (r.host === undefined || r.mode === "redirect") continue;
    const key = `${r.host}${r.expr}`;
    const prev = mountModes.get(key);
    if (prev === undefined) mountModes.set(key, r.mode);
    else if (prev !== r.mode) {
      throw new Error(
        `ROUTES validation failed: host "${r.host}" mount "${r.expr}" has routes in both "${prev}" and "${r.mode}" mode; one mount must use a single mode.`,
      );
    }
  }
  compiled.sort((a, b) => {
    const aTier = a.host ? (a.hostIsWildcard ? 1 : 0) : 2;
    const bTier = b.host ? (b.hostIsWildcard ? 1 : 0) : 2;
    if (aTier !== bTier) return aTier - bTier;
    if (b.baseSpecificity !== a.baseSpecificity) return b.baseSpecificity - a.baseSpecificity;
    return b.expr.length - a.expr.length;
  });
  return {
    routes: compiled,
    smoothTransitions: parsed.smoothTransitions,
  };
}

export type RouteMatch = {
  route: CompiledRoute;
  mountActual: string;
};

export function matchRoute(
  routes: CompiledRoute[],
  host: string,
  pathname: string,
): RouteMatch | null {
  let best: { match: RouteMatch; score: number; hostTier: number } | null = null;
  let rootRoute: { route: CompiledRoute; hostTier: number } | null = null;
  for (const route of routes) {
    let hostMatch = false;
    let hostTier = 2; // any-host
    if (route.host) {
      if (route.hostIsWildcard) {
        const tail = route.hostWildcardTail!;
        if (host.endsWith(tail) && host.length > tail.length) {
          const head = host.slice(0, -tail.length);
          if (head.length > 0 && !head.includes(".")) {
            hostMatch = true;
            hostTier = 1;
          }
        }
      } else if (route.host === host) {
        hostMatch = true;
        hostTier = 0;
      }
    } else {
      hostMatch = true;
    }
    if (!hostMatch) continue;

    if (route.staticMount === "/" && (!rootRoute || hostTier < rootRoute.hostTier)) {
      rootRoute = { route, hostTier };
    }

    const m = route.re.exec(pathname);
    if (!m) continue;
    const mountActual = normalizePath(m[1]!);
    const score =
      mountActual.length * 1_000_000 + route.baseSpecificity * 1_000 + route.expr.length;
    if (!best || hostTier < best.hostTier || (hostTier === best.hostTier && score > best.score)) {
      best = { match: { route, mountActual }, score, hostTier };
    }
  }
  if (best) return best.match;
  if (rootRoute) return { route: rootRoute.route, mountActual: "/" };
  return null;
}
