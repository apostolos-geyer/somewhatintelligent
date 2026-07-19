/**
 * Operator worker entry — the Access-protected boundary in front of the console
 * (RFC-0001 D1/D6/D7). Every request must resolve a valid `OperatorActor`
 * before any handling; the worker fails closed outside development.
 *
 * SCAFFOLD (exec-plan 0004 track T2 + the T3 boundary shape). Track T22 replaces
 * this plain fetch entry with the TanStack Start console (server-fn factory,
 * the eight modules, and the storage-neutral media-upload routes), keeping the
 * Access gate below in front of it.
 */
import { resolveOperator } from "./lib/access";
import type { OperatorEnv } from "./operator-env";

export default {
  async fetch(request: Request, env: OperatorEnv): Promise<Response> {
    const actor = await resolveOperator(request, env);
    if (!actor.ok) {
      // Misconfiguration fails as a server error; anything else is forbidden.
      const status = actor.error === "misconfigured" ? 500 : 403;
      return new Response(actor.error, { status });
    }

    // TODO(T22): hand off to the TanStack Start console for this authenticated
    // operator. For now, prove the gate resolved an actor.
    return new Response(`operator: ${actor.value.email}`, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
} satisfies ExportedHandler<OperatorEnv>;
