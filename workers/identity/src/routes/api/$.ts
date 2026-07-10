import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  getActorId,
  getActorKind,
  getCallerApp,
  getRequestId,
} from "@somewhatintelligent/kit/request-context";

// Catch-all proxy for every `/api/*` route on identity. Forwards to guestlist
// over the service binding so requests stay same-origin from the browser's
// perspective: no CORS preflight, cookies attach automatically, and the
// browser BA client only ever needs `${origin}/api/auth/...` URLs. Guestlist
// is never reached cross-origin from this app.
//
// Sits at `/api/$` so the same passthrough covers `/api/auth/*` (better-auth's
// own HTTP routes, incl. the org invitation endpoints) and the OIDC
// well-known metadata. Admin, org, user-directory, and avatar *mutations* are
// WorkerEntrypoint RPC now (see the `*.functions.ts` server fns), not HTTP —
// nothing routes them through here. The public avatar READ (`<img
// src=.../u/avatar/:refId>`) targets guestlist's own public origin directly
// (bouncer-fronted in prod), not this `/api/*` proxy.
async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  url.protocol = "http:";
  url.host = "guestlist.internal";
  const inner = new Request(url, request);

  const ip = request.headers.get("cf-connecting-ip");
  if (ip) {
    const fwd = inner.headers.get("x-forwarded-for");
    inner.headers.set("x-forwarded-for", fwd ? `${ip}, ${fwd}` : ip);
  }

  // Forward correlation: guestlist's fetch boundary reads these into its own
  // request-context ALS so cross-service canonical log lines match by
  // request_id and surface caller_app + actor info.
  const requestId = getRequestId();
  if (requestId) inner.headers.set("cf-request-id", requestId);
  const callerApp = getCallerApp();
  if (callerApp) inner.headers.set("x-caller-app", callerApp);
  const actorKind = getActorKind();
  if (actorKind) inner.headers.set("x-actor-kind", actorKind);
  const actorId = getActorId();
  if (actorId) inner.headers.set("x-actor-id", actorId);

  return env.GUESTLIST.fetch(inner);
}

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: ({ request }) => proxy(request),
      POST: ({ request }) => proxy(request),
      PUT: ({ request }) => proxy(request),
      PATCH: ({ request }) => proxy(request),
      DELETE: ({ request }) => proxy(request),
      OPTIONS: ({ request }) => proxy(request),
      HEAD: ({ request }) => proxy(request),
    },
  },
});
