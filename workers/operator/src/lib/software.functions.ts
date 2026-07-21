/**
 * Software server functions (RFC-0001 D8 factory: require actor → validate input
 * → build `OperatorMeta` server-side → one owning `PublisherOperator` RPC). The
 * browser supplies only the domain fields plus, for mutations, an opaque
 * `commandId` UUID; `OperatorMeta` is always derived server-side. Reads and
 * deletion plans mint a throwaway commandId. Mirrors `products.functions.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { type } from "arktype";
import { buildOperatorMeta, requireOperatorActor } from "@/lib/server-fn-actor";
import { publisherOperator } from "@/lib/publisher-operator";

const listInput = type({
  "state?": "'draft' | 'published' | 'retired' | 'all'",
  "cursor?": "string",
  "limit?": "number",
});

const getInput = type({ softwareId: "1 <= string <= 64" });

const searchInput = type({ query: "string <= 200" });

const createInput = type({
  commandId: "string.uuid",
  slug: "1 <= string <= 64",
  title: "1 <= string <= 200",
});

const saveInput = type({
  commandId: "string.uuid",
  softwareId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
  "slug?": "1 <= string <= 64",
  "title?": "1 <= string <= 200",
  "deck?": "string <= 400",
  "whatItIsMarkdown?": "string",
  "destinationUrl?": "1 <= string <= 2048",
  "actionLabel?": "1 <= string <= 80",
  "primaryMediaId?": "string | null",
});

const publishInput = type({
  commandId: "string.uuid",
  softwareId: "1 <= string <= 64",
  expectedRevision: "number.integer >= 0",
});

const retireInput = type({ commandId: "string.uuid", softwareId: "1 <= string <= 64" });

const planInput = type({ softwareId: "1 <= string <= 64" });

const confirmInput = type({ commandId: "string.uuid", confirmationToken: "1 <= string <= 512" });

export const listSoftware = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof listInput.infer) => listInput.assert(data ?? {}))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listSoftware", crypto.randomUUID());
    return publisherOperator().listSoftware({ input: data, meta });
  });

export const getSoftware = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof getInput.infer) => getInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "getSoftware", crypto.randomUUID());
    return publisherOperator().getSoftware({ input: data, meta });
  });

// Featured-software picker source: one listSoftware read, filtered + shaped to
// id/title/slug server-side. Mirrors `searchTexts`.
export const searchSoftware = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .validator((data: typeof searchInput.infer) => searchInput.assert(data ?? {}))
  .handler(async ({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "listSoftware", crypto.randomUUID());
    const res = await publisherOperator().listSoftware({
      input: { state: "all", limit: 100 },
      meta,
    });
    if (!res.ok) return [];
    const q = data.query.trim().toLowerCase();
    const matched =
      q === ""
        ? res.value.software
        : res.value.software.filter(
            (s) => s.slug.toLowerCase().includes(q) || s.title.toLowerCase().includes(q),
          );
    return matched
      .slice(0, 8)
      .map((s) => ({ softwareId: s.softwareId, title: s.title, slug: s.slug, state: s.state }));
  });

export const createSoftware = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof createInput.infer) => createInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "createSoftware", commandId);
    return publisherOperator().createSoftware({ input, meta });
  });

export const saveSoftwareDraft = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof saveInput.infer) => saveInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "saveSoftwareDraft", commandId);
    return publisherOperator().saveSoftwareDraft({ input, meta });
  });

export const publishSoftware = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof publishInput.infer) => publishInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "publishSoftware", commandId);
    return publisherOperator().publishSoftware({ input, meta });
  });

export const retireSoftware = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof retireInput.infer) => retireInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "retireSoftware", data.commandId);
    return publisherOperator().retireSoftware({ input: { softwareId: data.softwareId }, meta });
  });

export const planSoftwareDeletion = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof planInput.infer) => planInput.assert(data))
  .handler(({ data, context }) => {
    const meta = buildOperatorMeta(context.actor, "planSoftwareDeletion", crypto.randomUUID());
    return publisherOperator().planSoftwareDeletion({ input: data, meta });
  });

export const deleteSoftware = createServerFn({ method: "POST" })
  .middleware([requireOperatorActor])
  .validator((data: typeof confirmInput.infer) => confirmInput.assert(data))
  .handler(({ data, context }) => {
    const { commandId, ...input } = data;
    const meta = buildOperatorMeta(context.actor, "deleteSoftware", commandId);
    return publisherOperator().deleteSoftware({ input, meta });
  });
