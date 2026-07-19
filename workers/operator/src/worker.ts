/**
 * Operator worker entry — the Access-protected boundary in front of the
 * TanStack Start console (RFC-0001 D1/D6/D7). Every request resolves a valid
 * `OperatorActor` FIRST; the worker fails closed (403/500) outside development
 * before any route or server function runs (INV-ACCESS-1). On success the
 * verified actor is seeded into the TanStack Start request context so
 * server-fns read it via `requireOperatorActor` without re-verifying the JWT.
 *
 * Operator deploys directly on desk.* with its own hostname (NOT behind
 * bouncer), so there is no mount prefix to strip or restore here.
 */
import startEntry from "@tanstack/react-start/server-entry";
import { extractPlatformStartContext } from "@somewhatintelligent/kit/react-start";
import type { OperatorActor } from "@si/contracts";
import { resolveOperator } from "./lib/access";
import type { OperatorEnv } from "./operator-env";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { requestId: string; callerApp?: string; actor: OperatorActor } };
  }
}

export default {
  async fetch(request: Request, env: OperatorEnv): Promise<Response> {
    const resolved = await resolveOperator(request, env);
    if (!resolved.ok) {
      // Misconfiguration fails as a server error; anything else is forbidden.
      const status = resolved.error === "misconfigured" ? 500 : 403;
      return new Response(resolved.error, { status });
    }

    return startEntry.fetch(request, {
      context: { ...extractPlatformStartContext(request), actor: resolved.value },
    });
  },
} satisfies ExportedHandler<OperatorEnv>;
