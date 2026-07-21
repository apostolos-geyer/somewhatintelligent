/**
 * Orders server functions (RFC-0001 D7 factory: require actor → validate input →
 * build `OperatorMeta` server-side → one owning `StoreOperator` RPC). The browser
 * supplies only the domain fields plus, for mutations, an opaque `commandId` UUID;
 * `OperatorMeta` (actor/requestId/idempotencyKey) is always derived server-side.
 * Reads carry a throwaway server-minted commandId since the envelope requires
 * meta but the read cores never touch `idempotencyKey`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { storeOperator } from "@/lib/store-operator";

const listInput = type({
  "status?": "'pending' | 'paid' | 'shipped' | 'delivered' | 'cancelled' | 'all' | undefined",
  "cursor?": "string | undefined",
  "limit?": "number | undefined",
});

const orderNumberInput = type({ orderNumber: "1 <= string <= 64" });

const setStatusInput = type({
  commandId: "string.uuid",
  orderNumber: "1 <= string <= 64",
  status: "'paid' | 'cancelled'",
});

const fulfillInput = type({
  commandId: "string.uuid",
  orderNumber: "1 <= string <= 64",
  carrier: "1 <= string <= 40",
  trackingNumber: "1 <= string <= 80",
  "note?": "string <= 500 | undefined",
});

const markDeliveredInput = type({
  commandId: "string.uuid",
  orderNumber: "1 <= string <= 64",
});

export const listOrders = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof listInput.infer) => listInput.assert(data ?? {}))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listOrders", crypto.randomUUID());
    return storeOperator().listOrders({ input: data, meta });
  });

export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof orderNumberInput.infer) => orderNumberInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getOrder", crypto.randomUUID());
    return storeOperator().getOrder({ input: data, meta });
  });

export const setOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof setStatusInput.infer) => setStatusInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "setOrderStatus", commandId);
    return storeOperator().setOrderStatus({ input, meta });
  });

export const fulfillOrder = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof fulfillInput.infer) => fulfillInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "fulfillOrder", commandId);
    return storeOperator().fulfillOrder({ input, meta });
  });

export const markDelivered = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof markDeliveredInput.infer) => markDeliveredInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "markDelivered", commandId);
    return storeOperator().markDelivered({ input, meta });
  });
