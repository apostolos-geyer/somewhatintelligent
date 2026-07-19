/**
 * The server-fn side of the operator call contract (RFC-0001 D7). Every
 * operator server function attaches `requireOperatorActor` to read the
 * Access-verified `OperatorActor` that worker.ts seeded into the TSS request
 * context — it does NOT re-verify the JWT (that happened once at the boundary).
 * `buildOperatorMeta` derives `OperatorMeta` server-side: the browser supplies
 * only an opaque UUID `commandId`, never `actor`, `requestId`, or
 * `idempotencyKey`.
 */
import { createMiddleware, getGlobalStartContext } from "@tanstack/react-start";
import { type } from "arktype";
import { ulid } from "@somewhatintelligent/kit/ids";
import { commandIdSchema, deriveIdempotencyKey } from "@si/contracts/operator";
import type { OperatorActor, OperatorMeta } from "@si/contracts";

/**
 * Make the request's `OperatorActor` available to server-fn handlers as
 * `context.actor`. Reads the actor seeded in worker.ts's Access gate; its
 * absence means the boundary was bypassed, so fail closed with 500.
 */
export const requireOperatorActor = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const ctx = getGlobalStartContext() as { actor?: OperatorActor } | undefined;
    const actor = ctx?.actor;
    if (!actor) {
      throw new Response("operator actor unavailable", { status: 500 });
    }
    return next({ context: { actor } });
  },
);

/**
 * Build `OperatorMeta` for one owning-RPC call. `action` is the server-chosen
 * command name; `commandId` is the browser's opaque UUID, validated here before
 * it is namespaced into `<actor.sub>:<action>:<commandId>`. Server-side only.
 */
export function buildOperatorMeta(
  actor: OperatorActor,
  action: string,
  commandId: string,
): OperatorMeta {
  const parsed = commandIdSchema(commandId);
  if (parsed instanceof type.errors) {
    throw new Error(`commandId must be a UUID: ${parsed.summary}`);
  }
  return {
    actor,
    requestId: ulid(),
    idempotencyKey: deriveIdempotencyKey(actor.sub, action, commandId),
  };
}
