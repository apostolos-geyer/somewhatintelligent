import { withRequestLog } from "@greenroom/kit/log";
import {
  extractRequestId,
  routingHostFromHeaders,
  updateRequestContext,
  withRequestContext,
} from "@greenroom/kit/request-context";
import {
  buildAssetPrefixes,
  handleMountedApp,
  handlePassthrough,
  stampUpstreamHeaders,
  stripPlatformResponseHeaders,
} from "./proxy";
import { compileRoutes, matchRoute, type CompiledRoute } from "./routes";
import { mergeCookiesIntoRequest } from "./session";
import { getStamper } from "./envelope";

interface CompiledConfig {
  routes: CompiledRoute[];
  smoothTransitions?: boolean;
  assetPrefixes: string[];
}

const configCache = new WeakMap<Env, CompiledConfig>();

// THE routing host for a request: the bouncer-visible hostname every host-keyed
// decision (route matching, envelope stamping) must agree on. x-forwarded-host
// is portless's dev-only signal; trusting it in production would let a client
// spoof the routing host header, so it's honored only when ENVIRONMENT is
// development. One definition, used for the outer host AND passed to getStamper
// (the stamper invokes it per request against the request it's stamping — never
// a closed-over host, or getStamper's per-isolate memoization would freeze the
// first request's host into every envelope; see __tests__/stamper-host.test.ts).
function resolveRoutingHost(request: Request, env: Env): string {
  // Delegates to the shared rule (@greenroom/kit/request-context) so bouncer, the
  // dev stamper that emulates it, and the apps' host→brand reads all agree.
  // fallbackHost (the request URL host) guarantees a non-null result.
  return routingHostFromHeaders(request.headers, {
    // `as string`: generated Env types ENVIRONMENT as the wrangler.jsonc
    // section union ("staging" | "production"); dev's "development" is
    // injected by .dev.vars, which CI's type generation never sees (same
    // .dev.vars-independence rule as src/env.d.ts).
    trustForwardedHost: (env.ENVIRONMENT as string) === "development",
    fallbackHost: new URL(request.url).hostname,
  })!;
}

function getFetcher(env: Env, bindingName: string): Fetcher {
  // Route bindings (GUESTLIST, IDENTITY, …) are statically declared on Env
  // but resolved dynamically per-route — `Reflect.get` is the language-
  // blessed dynamic property access, returning a value we narrow at runtime.
  const upstream: unknown = Reflect.get(env, bindingName);
  if (
    !upstream ||
    typeof upstream !== "object" ||
    typeof (upstream as { fetch?: unknown }).fetch !== "function"
  ) {
    throw new Error(`bouncer: route binding "${bindingName}" is not a bound Fetcher`);
  }
  return upstream as Fetcher;
}

function loadConfig(env: Env): CompiledConfig {
  let cfg = configCache.get(env);
  if (cfg) return cfg;
  const raw: unknown = env.ROUTES;
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `bouncer: ROUTES is not valid JSON — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  } else {
    parsed = raw;
  }
  const compiled = compileRoutes(parsed);
  cfg = {
    routes: compiled.routes,
    smoothTransitions: compiled.smoothTransitions,
    assetPrefixes: buildAssetPrefixes(env),
  };
  configCache.set(env, cfg);
  return cfg;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    // Bouncer is a public-edge ingress: no upstream caller, so the request
    // context carries only the request id. caller_app is meaningful only on
    // app/service boundaries that receive an x-caller-app header.
    return withRequestContext({ requestId: extractRequestId(request) }, () =>
      withRequestLog({ service: "bouncer" }, request, async (log) => {
        const url = new URL(request.url);
        const host = resolveRoutingHost(request, env);
        log.add({ host });

        // The stamper resolves the host from the request it stamps, per call —
        // resolveRoutingHost is per-request-pure, so the same function serves
        // both the outer host above and the stamper. It must NOT close over
        // `host`: getStamper memoizes the stamper per isolate, so a captured
        // host would freeze the first request's host into every envelope the
        // isolate ever mints (see __tests__/stamper-host.test.ts).
        const stamp = await getStamper(env, (req) => resolveRoutingHost(req, env));
        const { envelope, setCookies, actor, activeOrgId } = await stamp(request);
        if (actor) updateRequestContext({ actorKind: "user", actorId: actor.id });
        log.add({
          refreshed: setCookies.length > 0,
          ...(activeOrgId && { active_org_id: activeOrgId }),
        });

        const cfg = loadConfig(env);
        const match = matchRoute(cfg.routes, host, url.pathname);

        const refreshedReq = mergeCookiesIntoRequest(request, setCookies);

        let response: Response;
        if (match) {
          const upstream = getFetcher(env, match.route.bindingName);
          const fwdReq = stampUpstreamHeaders(refreshedReq, envelope, actor);
          if (match.route.mode === "passthrough") {
            log.add({
              dispatch: "passthrough",
              mode: "passthrough",
              route_binding: match.route.bindingName,
            });
            response = await handlePassthrough(fwdReq, upstream);
          } else {
            const preloadStaticMounts = cfg.routes
              .filter(
                (r) =>
                  r.preload &&
                  r.isStaticMount &&
                  r.staticMount &&
                  r.staticMount !== match.mountActual,
              )
              .map((r) => r.staticMount!);
            log.add({
              dispatch: "vmf",
              mode: "vmf",
              route_binding: match.route.bindingName,
              ...(match.mountActual !== "/" && { mount: match.mountActual }),
            });
            response = await handleMountedApp(
              fwdReq,
              upstream,
              match.mountActual,
              cfg.assetPrefixes,
              {
                smoothTransitions: cfg.smoothTransitions,
                preloadStaticMounts: preloadStaticMounts.length ? preloadStaticMounts : undefined,
              },
            );
          }
        } else {
          // Unmatched site: every public host is an explicit bouncer-owned
          // Custom Domain; there's no fall-through upstream to forward to.
          // Returning 404 here also kills the dev-mode `fetch(refreshedReq)`
          // recursion that the prior fallback exposed when an upstream emitted
          // a Location pointing at bouncer's own bind address.
          log.add({ dispatch: "not_found" });
          response = new Response("Not Found", {
            status: 404,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }

        // Strip x-platform-att from upstream response before it leaves
        // bouncer — the envelope is internal-only and must not leak to the
        // browser. Apps don't echo it in practice, but defense in depth.
        response = stripPlatformResponseHeaders(response);

        if (setCookies.length > 0) {
          const outHeaders = new Headers(response.headers);
          for (const sc of setCookies) outHeaders.append("set-cookie", sc);
          response = new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: outHeaders,
          });
        }

        log.add({ status: response.status });
        if (response.status >= 500) log.outcome("internal_error");
        else if (response.status >= 400) log.outcome(`http_${response.status}`);
        return response;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
