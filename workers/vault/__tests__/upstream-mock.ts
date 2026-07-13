/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Host-routed upstream fake. `fetchMock` from cloudflare:test was removed on
// the vitest-4 pool line; the documented replacement is mocking
// globalThis.fetch — which reaches the DO's upstream calls too, because the
// worker under test (and its Durable Objects) run in the SAME isolate as the
// tests. Records every request for header-hygiene assertions and THROWS on
// unrouted hosts, proving nothing escapes to the real network.

export interface RecordedRequest {
  url: string;
  host: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

export type UpstreamHandler = (req: Request, body: string) => Response | Promise<Response>;

export interface Upstream {
  recorded: RecordedRequest[];
  /** Requests that hit a given host. */
  to(host: string): RecordedRequest[];
  restore(): void;
}

export function installUpstream(routes: Record<string, UpstreamHandler>): Upstream {
  const recorded: RecordedRequest[] = [];
  const mocked = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input as RequestInfo, init);
    const url = new URL(req.url);
    // decode via arrayBuffer: .text() on urlencoded bodies trips a workerd
    // content-type warning on every call.
    const body = req.body ? new TextDecoder().decode(await req.clone().arrayBuffer()) : "";
    const headers: Record<string, string> = {};
    req.headers.forEach((v, k) => {
      headers[k] = v;
    });
    recorded.push({ url: req.url, host: url.hostname, method: req.method, headers, body });
    const handler = routes[url.hostname];
    if (!handler) {
      throw new Error(`upstream-mock: unrouted host ${url.hostname} — refusing real network`);
    }
    return handler(req, body);
  };
  vi.stubGlobal("fetch", mocked);
  return {
    recorded,
    to: (host) => recorded.filter((r) => r.host === host),
    restore: () => vi.unstubAllGlobals(),
  };
}

/** Minimal OAuth provider: counts exchanges/refreshes, issues sequenced tokens. */
export function mockOAuthProvider(opts?: {
  expiresIn?: number;
  refreshStatus?: number;
  delayMs?: number;
}) {
  const state = { exchanges: 0, refreshes: 0 };
  const handler: UpstreamHandler = async (_req, body) => {
    if (opts?.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const params = new URLSearchParams(body);
    const grantType = params.get("grant_type");
    if (grantType === "refresh_token") {
      state.refreshes++;
      if (opts?.refreshStatus && opts.refreshStatus >= 400) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: opts.refreshStatus,
        });
      }
      return Response.json({
        access_token: `refreshed-token-${state.refreshes}`,
        refresh_token: `refresh-token-${state.refreshes}`,
        expires_in: opts?.expiresIn ?? 3600,
        scope: "repo",
      });
    }
    state.exchanges++;
    return Response.json({
      access_token: `exchanged-token-${state.exchanges}`,
      refresh_token: "refresh-token-0",
      expires_in: opts?.expiresIn ?? 3600,
      scope: "repo",
    });
  };
  return { handler, state };
}

/** Echo destination API: reflects method/path/body so passthrough is assertable. */
export const echoApi: UpstreamHandler = (req, body) => {
  const url = new URL(req.url);
  return Response.json(
    { path: url.pathname, method: req.method, echo: body },
    { status: 200, headers: { "x-upstream": "echo" } },
  );
};
