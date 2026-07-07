import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import {
  getActorId,
  getActorKind,
  getCallerApp,
  getRequestId,
} from "@greenroom/kit/request-context";

// Catch-all proxy for every `/api/*` route on this app. Forwards to guestlist
// over the service binding so requests stay same-origin from the browser's
// perspective: no CORS preflight, cookies attach automatically, and
// browser-side helpers (BA client, `guestlist.setAvatar`, etc.) only ever
// need `${origin}/api/...` URLs. Guestlist is never reached cross-origin
// from this app.
//
// Sits at `/api/$` so the same passthrough covers `/api/auth/*`, `/api/avatar/*`,
// and any future guestlist-native API surfaces without per-prefix duplication.
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
