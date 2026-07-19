/**
 * Pages server functions (RFC-0001 D8/D9 factory: require actor → validate input
 * → build `OperatorMeta` server-side → one owning `PublisherOperator` RPC). The
 * fixed page documents are discriminated unions; the envelope scalars are
 * arktype-validated here while the document itself is authoritatively validated
 * by Publisher at the write boundary (INV-PAGE-1, returning `invalid_document`).
 * Mirrors `products.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { publisherOperator } from "@/lib/publisher-operator";
import type { PageDocumentByKey, PageKey } from "@si/contracts";

const keyLiteral = "'home' | 'shop' | 'writing' | 'software' | 'about'";

const getMeta = type({ key: keyLiteral });
const createMeta = type({ commandId: "string.uuid", key: keyLiteral });
const saveMeta = type({
  commandId: "string.uuid",
  key: keyLiteral,
  expectedRevision: "number.integer >= 0",
});
const publishInput = type({
  commandId: "string.uuid",
  key: keyLiteral,
  expectedRevision: "number.integer >= 0",
  version: "1 <= string <= 32",
});
const planPageInput = type({ key: keyLiteral });
const planReleaseInput = type({
  key: keyLiteral,
  releaseId: "1 <= string <= 64",
  "replacementReleaseId?": "string | null",
});
const confirmInput = type({ commandId: "string.uuid", confirmationToken: "1 <= string <= 512" });

type CreateData = { commandId: string; key: PageKey; document: PageDocumentByKey[PageKey] };
type SaveData = CreateData & { expectedRevision: number };

export const getPage = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof getMeta.infer) => getMeta.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getPage", crypto.randomUUID());
    return publisherOperator().getPage({ input: data, meta });
  });

export const createPage = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: CreateData) => {
    createMeta.assert({ commandId: data.commandId, key: data.key });
    return data;
  })
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "createPage", data.commandId);
    return publisherOperator().createPage({
      input: { key: data.key, document: data.document },
      meta,
    });
  });

export const savePageDraft = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: SaveData) => {
    saveMeta.assert({
      commandId: data.commandId,
      key: data.key,
      expectedRevision: data.expectedRevision,
    });
    return data;
  })
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "savePageDraft", data.commandId);
    return publisherOperator().savePageDraft({
      input: { key: data.key, expectedRevision: data.expectedRevision, document: data.document },
      meta,
    });
  });

export const publishPage = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof publishInput.infer) => publishInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "publishPage", commandId);
    return publisherOperator().publishPage({ input, meta });
  });

export const planPageDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planPageInput.infer) => planPageInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planPageDeletion", crypto.randomUUID());
    return publisherOperator().planPageDeletion({ input: data, meta });
  });

export const deletePage = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deletePage", commandId);
    return publisherOperator().deletePage({ input, meta });
  });

export const planPageReleaseDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planReleaseInput.infer) => planReleaseInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planPageReleaseDeletion", crypto.randomUUID());
    return publisherOperator().planPageReleaseDeletion({ input: data, meta });
  });

export const deletePageRelease = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deletePageRelease", commandId);
    return publisherOperator().deletePageRelease({ input, meta });
  });
