/**
 * Media deletion server functions (RFC-0001 D8/D10). Media is addressed by a
 * cross-owner `mediaId`; there is no cross-owner listing RPC, so the Media
 * module browses owner-scoped via `getText`/`getSoftware`/`getPage` and deletes
 * here. Plans mint a throwaway commandId; confirm threads the browser's UUID for
 * idempotent execution. Mirrors `products.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { publisherOperator } from "@/lib/publisher-operator";

const planInput = type({ mediaId: "1 <= string <= 64" });
const confirmInput = type({ commandId: "string.uuid", confirmationToken: "1 <= string <= 512" });

export const planMediaDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planInput.infer) => planInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planMediaDeletion", crypto.randomUUID());
    return publisherOperator().planMediaDeletion({ input: data, meta });
  });

export const deleteMedia = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteMedia", commandId);
    return publisherOperator().deleteMedia({ input, meta });
  });
