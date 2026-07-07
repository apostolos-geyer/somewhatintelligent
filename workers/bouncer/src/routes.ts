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

// `passthrough` (default): one upstream owns this host fully — bouncer is a
// transparent reverse proxy. No URL/asset/cookie/redirect rewriting.
// `vmf`: one or more mount-naive upstreams under this host — bouncer runs
// the full Cloudflare-microfrontend transformation pipeline (path strip,
// asset-prefix rewriting, Location/cookie path scoping, preload injection).
// Mode is fixed per host; mixing modes for routes that share a host is a
// boot-time error (see compileRoutes' per-host mode-consistency check).
const RouteModeSchema = type("'passthrough' | 'vmf'");

const RouteConfigSchema = type({
  binding: "string > 0",
  "host?": "string | string[]",
  path: "string > 0",
  "preload?": "boolean",
  "mode?": RouteModeSchema,
});

const RoutesConfigSchema = type({
  "smoothTransitions?": "boolean",
  routes: RouteConfigSchema.array(),
});

type RouteMode = typeof RouteModeSchema.infer;

export type CompiledRoute = {
  expr: string;
  bindingName: string;
  host?: string;
  hostIsWildcard: boolean;
  hostWildcardTail?: string;
  preload?: boolean;
  mode: RouteMode;
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
    const mode: RouteMode = rec.mode ?? "passthrough";
    for (const host of hosts) {
      const hostIsWildcard = !!host?.startsWith("*.");
      compiled.push({
        expr,
        bindingName: rec.binding,
        host,
        hostIsWildcard,
        hostWildcardTail: hostIsWildcard ? host!.slice(1) : undefined,
        preload: rec.preload,
        mode,
        re,
        isStaticMount,
        staticMount,
        baseSpecificity: computeBaseSpecificity(expr),
      });
    }
  }
  // Per-host mode consistency: a single host either runs in passthrough or
  // vmf mode for *all* its routes. Mixing them is nonsense (the upstream
  // contract differs) and almost certainly a config bug, so reject at boot.
  // Wildcard hosts are checked separately from exact hosts since they're
  // distinct match tiers.
  const hostModes = new Map<string, RouteMode>();
  for (const r of compiled) {
    if (r.host === undefined) continue;
    const prev = hostModes.get(r.host);
    if (prev === undefined) hostModes.set(r.host, r.mode);
    else if (prev !== r.mode) {
      throw new Error(
        `ROUTES validation failed: host "${r.host}" has routes in both "${prev}" and "${r.mode}" mode; one host must use a single mode.`,
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
