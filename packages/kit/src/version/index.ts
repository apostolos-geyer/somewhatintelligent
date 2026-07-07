/**
 * `/__version` — one tiny, shared implementation of the fleet's version
 * endpoint (exec plan 0001: "version strings rendered in every app and
 * `/__version` on API workers"), so bouncer/guestlist/roadie/promoter don't
 * carry four copies.
 *
 * Where the values come from:
 * - `version` / `commit` are injected AT SHIP TIME as plain worker vars
 *   (`WORKER_VERSION` / `WORKER_COMMIT`): scripts/deploy-worker.sh appends
 *   `--var` flags to every `wrangler deploy`, and
 *   scripts/generate-preview-tasks.sh does the same for `wrangler versions
 *   upload`, so promoted PR versions carry the values they were built from.
 *   Vite-built apps (identity) instead bake build-time constants via `define`
 *   (the inbox pattern) and pass them through `overrides`.
 * - `environment` reads the worker's existing `ENVIRONMENT` var.
 * - Everything falls back safely — local dev / tests (no injection) report
 *   `0.0.0-dev` / `unknown` / `development` instead of throwing.
 *
 * The env parameter is deliberately a loose record: the injected vars are
 * ship-time-only, so they never appear in any generated `Env` type.
 */

export interface VersionInfo {
  worker: string;
  version: string;
  commit: string;
  environment: string;
}

export const VERSION_PATH = "/__version";

export interface VersionOptions {
  /** The worker's canonical name (e.g. "guestlist"). */
  worker: string;
  /** The worker's env bindings (any shape — only string vars are read). */
  env?: unknown;
  /**
   * Pathnames that answer. Defaults to just `/__version`. A worker mounted
   * WITHOUT prefix-stripping (guestlist behind bouncer's `/api` passthrough)
   * adds its mounted spelling too, e.g. `["/__version", "/api/__version"]`,
   * so the endpoint stays reachable through the mount.
   */
  paths?: readonly string[];
  /** Field overrides for build-time-injected values (vite `define` apps). */
  overrides?: Partial<Omit<VersionInfo, "worker">>;
}

function readStringVar(env: unknown, key: string): string | undefined {
  if (typeof env !== "object" || env === null) return undefined;
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Resolve the version payload for a worker (fallbacks, never throws). */
export function versionInfo(options: VersionOptions): VersionInfo {
  const { worker, env, overrides } = options;
  return {
    worker,
    version: overrides?.version ?? readStringVar(env, "WORKER_VERSION") ?? "0.0.0-dev",
    commit: overrides?.commit ?? readStringVar(env, "WORKER_COMMIT") ?? "unknown",
    environment: overrides?.environment ?? readStringVar(env, "ENVIRONMENT") ?? "development",
  };
}

/** Serialize a payload as the endpoint's JSON response. */
export function versionResponse(info: VersionInfo): Response {
  return new Response(JSON.stringify(info), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * Answer a `/__version` request, or return null so the caller's normal
 * routing proceeds. GET/HEAD only — anything else falls through.
 */
export function handleVersionRequest(request: Request, options: VersionOptions): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const paths = options.paths ?? [VERSION_PATH];
  const { pathname } = new URL(request.url);
  if (!paths.includes(pathname)) return null;
  return versionResponse(versionInfo(options));
}
