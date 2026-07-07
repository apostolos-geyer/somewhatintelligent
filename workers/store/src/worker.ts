// Hand-written entry; do not wrap in a kit factory. Mirrors
// workers/identity/src/worker.ts (docs/ARCHITECTURE.md §3.3 + §4.4).
import startEntry from "@tanstack/react-start/server-entry";
import { extractPlatformStartContext } from "@si/kit/react-start";
import { devEnvelopeStamper } from "./lib/platform";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { requestId: string; callerApp?: string } };
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Dev-direct stamper mints an attestation envelope from the session cookie
    // so the principal (and the admin gate / admin server fns) resolves without
    // a bouncer in front. Hard no-op outside dev — see ARCHITECTURE.md §4.5.
    const { request: stamped, setCookies } = devEnvelopeStamper
      ? await devEnvelopeStamper(request)
      : { request, setCookies: [] as string[] };

    const response = await startEntry.fetch(stamped, {
      context: extractPlatformStartContext(stamped),
    });
    if (setCookies.length === 0) return response;
    const headers = new Headers(response.headers);
    for (const sc of setCookies) headers.append("set-cookie", sc);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
