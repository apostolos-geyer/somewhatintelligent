// Hand-written entry; do not wrap in a kit factory. Rationale in
// docs/ARCHITECTURE.md §3.3 + §4.4.
import startEntry from "@tanstack/react-start/server-entry";
import { extractPlatformStartContext } from "@somewhatintelligent/kit/react-start";
import { runWithExecutionContext } from "@somewhatintelligent/kit/execution-context";
import { handleVersionRequest } from "@somewhatintelligent/kit/version";
import { devEnvelopeStamper } from "./lib/platform";
import { APP_COMMIT, APP_VERSION } from "./lib/version";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { requestId: string; callerApp?: string } };
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return runWithExecutionContext(ctx, async () => {
      // /__version at the worker boundary — cleaner than a TanStack file route
      // (a `__`-prefixed route filename would collide with the router's
      // pathless-layout convention). version/commit are the vite-define
      // build-time constants (see ./lib/version + vite.config.ts); reachable
      // through bouncer as /account/__version (vmf strips the mount).
      const version = handleVersionRequest(request, {
        worker: "identity",
        env,
        overrides: { version: APP_VERSION, commit: APP_COMMIT },
      });
      if (version) return version;

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
    });
  },
} satisfies ExportedHandler<Env>;
