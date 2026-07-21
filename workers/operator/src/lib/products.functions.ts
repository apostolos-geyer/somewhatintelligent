/**
 * Objects (products) server functions (RFC-0001 D7 factory: require actor →
 * validate input → build `OperatorMeta` server-side → one owning `StoreOperator`
 * RPC). The browser supplies only the domain fields plus, for mutations, an
 * opaque `commandId` UUID; `OperatorMeta` (actor/requestId/idempotencyKey) is
 * always derived server-side by `buildOperatorMeta`. Reads (and deletion plans)
 * carry a throwaway server-minted commandId since the envelope requires meta but
 * their cores never touch `idempotencyKey`. Mirrors `orders.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { storeOperator } from "@/lib/store-operator";

const listInput = type({
  "status?": "'draft' | 'active' | 'unavailable' | 'archived' | 'all' | undefined",
  "cursor?": "string | undefined",
  "limit?": "number | undefined",
});

const getInput = type({ productId: "1 <= string <= 64" });

const searchInput = type({ query: "string <= 200" });

const createInput = type({
  commandId: "string.uuid",
  slug: "1 <= string <= 64",
  title: "1 <= string <= 200",
  "descriptionMarkdown?": "string | null | undefined",
  priceCents: "number.integer >= 0",
});

const saveInput = type({
  commandId: "string.uuid",
  productId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  "title?": "(1 <= string <= 200) | undefined",
  "descriptionMarkdown?": "string | null | undefined",
  "priceCents?": "(number.integer >= 0) | undefined",
  "slug?": "(1 <= string <= 64) | undefined",
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
  "variantId?": "(1 <= string <= 64) | undefined",
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

const planProductInput = type({ productId: "1 <= string <= 64" });

const planReleaseInput = type({
  productId: "1 <= string <= 64",
  releaseId: "1 <= string <= 64",
  "replacementReleaseId?": "string | null | undefined",
});

const planVariantInput = type({
  productId: "1 <= string <= 64",
  variantId: "1 <= string <= 64",
});

const planMediaInput = type({
  productId: "1 <= string <= 64",
  mediaId: "1 <= string <= 64",
});

const confirmInput = type({ commandId: "string.uuid", confirmationToken: "1 <= string <= 512" });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof listInput.infer) => listInput.assert(data ?? {}))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listProducts", crypto.randomUUID());
    return storeOperator().listProducts({ input: data, meta });
  });

export const getProduct = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof getInput.infer) => getInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getProduct", crypto.randomUUID());
    return storeOperator().getProduct({ input: data, meta });
  });

// Featured-product picker source: one listProducts read, filtered + shaped to
// id/title/slug server-side. Mirrors `searchTexts`.
export const searchProducts = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof searchInput.infer) => searchInput.assert(data ?? {}))
  .handler(async ({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listProducts", crypto.randomUUID());
    const res = await storeOperator().listProducts({ input: { status: "all", limit: 100 }, meta });
    if (!res.ok) return [];
    const q = data.query.trim().toLowerCase();
    const matched =
      q === ""
        ? res.value.products
        : res.value.products.filter(
            (p) => p.slug.toLowerCase().includes(q) || p.title.toLowerCase().includes(q),
          );
    return matched
      .slice(0, 8)
      .map((p) => ({ productId: p.productId, title: p.title, slug: p.slug, status: p.status }));
  });

export const createProduct = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof createInput.infer) => createInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "createProduct", commandId);
    return storeOperator().createProduct({ input, meta });
  });

export const saveProductDraft = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof saveInput.infer) => saveInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "saveProductDraft", commandId);
    return storeOperator().saveProductDraft({ input, meta });
  });

export const publishProduct = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof publishInput.infer) => publishInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "publishProduct", commandId);
    return storeOperator().publishProduct({ input, meta });
  });

export const putVariant = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof putVariantInput.infer) => putVariantInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "putVariant", commandId);
    return storeOperator().putVariant({ input, meta });
  });

export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof adjustStockInput.infer) => adjustStockInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "adjustStock", commandId);
    return storeOperator().adjustStock({ input, meta });
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof setStatusInput.infer) => setStatusInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "setProductStatus", commandId);
    return storeOperator().setProductStatus({ input, meta });
  });

// ── Hard-delete plan/confirm pairs (RFC-0001 D8): plans mint a throwaway
// commandId; confirms consume the browser-supplied commandId as idempotency key.

export const planProductDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planProductInput.infer) => planProductInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planProductDeletion", crypto.randomUUID());
    return storeOperator().planProductDeletion({ input: data, meta });
  });

export const deleteProduct = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteProduct", commandId);
    return storeOperator().deleteProduct({ input, meta });
  });

export const planProductReleaseDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planReleaseInput.infer) => planReleaseInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(
      context.actor,
      "planProductReleaseDeletion",
      crypto.randomUUID(),
    );
    return storeOperator().planProductReleaseDeletion({ input: data, meta });
  });

export const deleteProductRelease = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteProductRelease", commandId);
    return storeOperator().deleteProductRelease({ input, meta });
  });

export const planVariantDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planVariantInput.infer) => planVariantInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planVariantDeletion", crypto.randomUUID());
    return storeOperator().planVariantDeletion({ input: data, meta });
  });

export const deleteVariant = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteVariant", commandId);
    return storeOperator().deleteVariant({ input, meta });
  });

export const planProductMediaDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planMediaInput.infer) => planMediaInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planProductMediaDeletion", crypto.randomUUID());
    return storeOperator().planProductMediaDeletion({ input: data, meta });
  });

export const deleteProductMedia = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteProductMedia", commandId);
    return storeOperator().deleteProductMedia({ input, meta });
  });
