// Hand-written entry; do not wrap in a kit factory. Queue + scheduled handlers
// and the GroupChatRoom DO export must live at the entry boundary; the WS upgrade
// is intercepted before TSS sees it (TSS chokes on 101 responses). `env` is
// never read at module top level (TSS
// bundle-leakage constraint) — the config latch + all env access live in fetch.
import { env } from "cloudflare:workers";
import startEntry from "@tanstack/react-start/server-entry";
import { routePartykitRequest } from "partyserver";
import { extractPlatformStartContext, type PlatformStartContext } from "@greenroom/kit/react-start";
import { withRequestLog } from "@greenroom/kit/log";
import { withRequestContext } from "@greenroom/kit/request-context";
import type { SproutEnv } from "./sprout-env";
import { handleCron } from "./jobs/cron";
import { handleQueueBatch } from "./jobs/queue";
import { assertConfigSafe, loadConfig } from "./lib/config";
import { devEnvelopeStamper } from "./lib/platform";

export { GroupChatRoom } from "./room-server";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: PlatformStartContext };
  }
}

// Boot-time safety check. Fires once on first request because `env` isn't
// readable at module top level.
let configChecked = false;

export default {
  async fetch(request: Request): Promise<Response> {
    if (!configChecked) {
      assertConfigSafe(
        loadConfig({ ENVIRONMENT: (env as { ENVIRONMENT?: string }).ENVIRONMENT ?? "development" }),
      );
      configChecked = true;
    }
    // Dev-direct stamper runs before the WS branch so DO upgrades also get an
    // envelope. Hard no-op outside dev.
    const { request: stamped, setCookies } = devEnvelopeStamper
      ? await devEnvelopeStamper(request)
      : { request, setCookies: [] as string[] };
    const platformCtx = extractPlatformStartContext(stamped);

    // The fetch boundary is the ONE place guaranteed to see every request and
    // every failure mode — including errors TanStack catches and masks during
    // route-module load (before any request middleware runs, as in the arktype
    // regression). Opening the canonical scope here means EVERY request emits
    // exactly one canonical line, and any throw is logged WITH a traceback (via
    // `withCanonicalLog`) before we return a 500 — never an opaque crash. The
    // server-fn middleware patches this same scope, so server-fn lines are
    // unaffected.
    return withRequestContext(
      { requestId: platformCtx.requestId, callerApp: platformCtx.callerApp },
      () =>
        withRequestLog({ service: "sprout" }, stamped, async (log) => {
          const url = new URL(stamped.url);
          if (url.pathname.startsWith("/ws/")) {
            const resp =
              (await routePartykitRequest(stamped, env as SproutEnv, { prefix: "ws" })) ??
              new Response("not found", { status: 404 });
            log.add({ status: resp.status });
            if (resp.status >= 500) log.outcome("internal_error");
            return resp;
          }

          let response: Response;
          try {
            response = await startEntry.fetch(stamped, { context: platformCtx });
          } catch (err) {
            // TanStack normally masks throws into a 500 response, but a throw
            // during route-module load can escape here. `withCanonicalLog` emits
            // the internal_error line + traceback as this rejects; convert it to
            // a 500 so the worker never surfaces an opaque runtime error.
            log.add({ status: 500 });
            throw err;
          }

          log.add({ status: response.status });
          if (response.status >= 500) log.outcome("internal_error");
          else if (response.status >= 400) log.outcome(`http_${response.status}`);

          if (setCookies.length === 0) return response;
          const headers = new Headers(response.headers);
          for (const sc of setCookies) headers.append("set-cookie", sc);
          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers,
          });
        }).catch(
          (): Response =>
            new Response(
              JSON.stringify({ error: "internal_error", requestId: platformCtx.requestId }),
              {
                status: 500,
                headers: { "content-type": "application/json" },
              },
            ),
        ),
    );
  },
  queue: handleQueueBatch,
  scheduled: handleCron,
} satisfies ExportedHandler<Env>;
