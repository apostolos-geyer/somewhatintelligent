/**
 * Texts server functions (RFC-0001 D8/D13 factory: require actor → validate
 * input → build `OperatorMeta` server-side → one owning `PublisherOperator` RPC).
 * The browser supplies only the domain fields plus, for mutations, an opaque
 * `commandId` UUID; `OperatorMeta` (actor/requestId/idempotencyKey) is always
 * derived server-side. Reads (and deletion plans) mint a throwaway commandId
 * since the envelope requires meta but their cores never key on idempotency.
 * Mirrors `products.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { publisherOperator } from "@/lib/publisher-operator";
import { toWikilinkSuggestions } from "@/lib/wikilink";

const listInput = type({
  "state?": "'draft' | 'published' | 'retired' | 'all'",
  "cursor?": "string",
  "limit?": "number",
});

const getInput = type({ textId: "1 <= string <= 64" });

const searchInput = type({ query: "string <= 200" });

const createInput = type({
  commandId: "string.uuid",
  slug: "1 <= string <= 64",
  title: "1 <= string <= 200",
});

const saveInput = type({
  commandId: "string.uuid",
  textId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  "slug?": "1 <= string <= 64",
  "title?": "1 <= string <= 200",
  "deck?": "string | null",
  "bodyMarkdown?": "string",
  "tags?": "string[]",
});

const publishInput = type({
  commandId: "string.uuid",
  textId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  version: "1 <= string <= 32",
});

const retireInput = type({ commandId: "string.uuid", textId: "1 <= string <= 64" });

const planTextInput = type({ textId: "1 <= string <= 64" });

const planReleaseInput = type({
  textId: "1 <= string <= 64",
  releaseId: "1 <= string <= 64",
  "replacementReleaseId?": "string | null",
});

const confirmInput = type({ commandId: "string.uuid", confirmationToken: "1 <= string <= 512" });

export const listTexts = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof listInput.infer) => listInput.assert(data ?? {}))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listTexts", crypto.randomUUID());
    return publisherOperator().listTexts({ input: data, meta });
  });

export const getText = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof getInput.infer) => getInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getText", crypto.randomUUID());
    return publisherOperator().getText({ input: data, meta });
  });

// Wikilink autocomplete source: one listTexts read, filtered + shaped server-side.
export const searchTexts = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof searchInput.infer) => searchInput.assert(data ?? {}))
  .handler(async ({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listTexts", crypto.randomUUID());
    const res = await publisherOperator().listTexts({ input: { state: "all", limit: 100 }, meta });
    if (!res.ok) return [];
    return toWikilinkSuggestions(res.value.texts, data.query);
  });

// Featured-text picker source: one listTexts read, filtered + shaped to
// id/title/slug server-side. Distinct from `searchTexts` (which shapes to
// slug/title wikilink suggestions with no id); the featured-text reference the
// document stores — and Publisher gates at publish — is the text ENTRY id.
export const searchTextsForFeature = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof searchInput.infer) => searchInput.assert(data ?? {}))
  .handler(async ({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listTexts", crypto.randomUUID());
    const res = await publisherOperator().listTexts({ input: { state: "all", limit: 100 }, meta });
    if (!res.ok) return [];
    const q = data.query.trim().toLowerCase();
    const matched =
      q === ""
        ? res.value.texts
        : res.value.texts.filter(
            (t) => t.slug.toLowerCase().includes(q) || t.title.toLowerCase().includes(q),
          );
    return matched
      .slice(0, 8)
      .map((t) => ({ textId: t.textId, title: t.title, slug: t.slug, state: t.state }));
  });

export const createText = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof createInput.infer) => createInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "createText", commandId);
    return publisherOperator().createText({ input, meta });
  });

export const saveTextDraft = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof saveInput.infer) => saveInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "saveTextDraft", commandId);
    return publisherOperator().saveTextDraft({ input, meta });
  });

export const publishText = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof publishInput.infer) => publishInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "publishText", commandId);
    return publisherOperator().publishText({ input, meta });
  });

export const retireText = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof retireInput.infer) => retireInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "retireText", data.commandId);
    return publisherOperator().retireText({ input: { textId: data.textId }, meta });
  });

export const planTextDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planTextInput.infer) => planTextInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planTextDeletion", crypto.randomUUID());
    return publisherOperator().planTextDeletion({ input: data, meta });
  });

export const deleteText = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteText", commandId);
    return publisherOperator().deleteText({ input, meta });
  });

export const planTextReleaseDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planReleaseInput.infer) => planReleaseInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planTextReleaseDeletion", crypto.randomUUID());
    return publisherOperator().planTextReleaseDeletion({ input: data, meta });
  });

export const deleteTextRelease = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteTextRelease", commandId);
    return publisherOperator().deleteTextRelease({ input, meta });
  });
