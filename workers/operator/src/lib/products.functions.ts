/**
 * Objects (products) server functions (RFC-0001 D7 factory: require actor →
 * validate input → build `OperatorMeta` server-side → one owning `StoreOperator`
 * RPC). The browser supplies only the domain fields plus, for mutations, an
 * opaque `commandId` UUID; `OperatorMeta` (actor/requestId/idempotencyKey) is
 * always derived server-side by `buildOperatorMeta`. Reads carry a throwaway
 * server-minted commandId since the envelope requires meta but the read cores
 * never touch `idempotencyKey`. Mirrors `orders.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { storeOperator } from "@/lib/store-operator";

const listInput = type({
  "status?": "'draft' | 'active' | 'unavailable' | 'archived' | 'all'",
  "cursor?": "string",
  "limit?": "number",
});

const getInput = type({ productId: "1 <= string <= 64" });

const createInput = type({
  commandId: "string.uuid",
  slug: "1 <= string <= 64",
  title: "1 <= string <= 200",
  "descriptionMarkdown?": "string | null",
  priceCents: "number.integer >= 0",
});

const saveInput = type({
  commandId: "string.uuid",
  productId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  "title?": "1 <= string <= 200",
  "descriptionMarkdown?": "string | null",
  "priceCents?": "number.integer >= 0",
  "slug?": "1 <= string <= 64",
});

const publishInput = type({
  commandId: "string.uuid",
  productId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  version: "1 <= string <= 32",
});

const putVariantInput = type({
  commandId: "string.uuid",
  productId: "1 <= string <= 64",
  "variantId?": "1 <= string <= 64",
  size: "1 <= string <= 40",
  sku: "1 <= string <= 80",
  stock: "number.integer >= 0",
});

const adjustStockInput = type({
  commandId: "string.uuid",
  variantId: "1 <= string <= 64",
  delta: "number.integer",
  reason: "1 <= string <= 200",
});

const setStatusInput = type({
  commandId: "string.uuid",
  productId: "1 <= string <= 64",
  status: "'draft' | 'active' | 'unavailable' | 'archived'",
});

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof listInput.infer) => listInput.assert(data ?? {}))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listProducts", crypto.randomUUID());
    return storeOperator().listProducts({ input: data, meta });
  });

export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof getInput.infer) => getInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getProduct", crypto.randomUUID());
    return storeOperator().getProduct({ input: data, meta });
  });

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof createInput.infer) => createInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "createProduct", commandId);
    return storeOperator().createProduct({ input, meta });
  });

export const saveProductDraft = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof saveInput.infer) => saveInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "saveProductDraft", commandId);
    return storeOperator().saveProductDraft({ input, meta });
  });

export const publishProduct = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof publishInput.infer) => publishInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "publishProduct", commandId);
    return storeOperator().publishProduct({ input, meta });
  });

export const putVariant = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof putVariantInput.infer) => putVariantInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "putVariant", commandId);
    return storeOperator().putVariant({ input, meta });
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof adjustStockInput.infer) => adjustStockInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "adjustStock", commandId);
    return storeOperator().adjustStock({ input, meta });
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .inputValidator((data: typeof setStatusInput.infer) => setStatusInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "setProductStatus", commandId);
    return storeOperator().setProductStatus({ input, meta });
  });
