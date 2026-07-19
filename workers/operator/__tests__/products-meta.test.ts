import { deriveIdempotencyKey, type OperatorActor } from "@si/contracts";
import { buildOperatorMeta } from "../src/lib/server-fn-actor";

// The OperatorMeta derivation the Objects (products) server functions rely on
// (RFC-0001 D7). `products.functions.ts` builds each StoreOperator call as
// `{ input, meta: buildOperatorMeta(context.actor, "<action>", commandId) }` —
// a browser mutation supplies only the opaque `commandId`, while mutating
// actions thread it through and reads mint a throwaway one. These lock the
// action strings and the `<sub>:<action>:<commandId>` idempotency contract.

const ACTOR: OperatorActor = { sub: "op-sub-7", email: "op@example.com" };
const MUTATION_ACTIONS = [
  "createProduct",
  "saveProductDraft",
  "publishProduct",
  "putVariant",
  "adjustStock",
  "setProductStatus",
] as const;

describe("products server-fn OperatorMeta derivation", () => {
  test("mutations namespace the browser commandId as <sub>:<action>:<commandId>", () => {
    for (const action of MUTATION_ACTIONS) {
      const commandId = crypto.randomUUID();
      const meta = buildOperatorMeta(ACTOR, action, commandId);
      expect(meta.idempotencyKey).toBe(`op-sub-7:${action}:${commandId}`);
      expect(meta.idempotencyKey).toBe(deriveIdempotencyKey(ACTOR.sub, action, commandId));
      expect(meta.actor).toEqual(ACTOR);
    }
  });

  test("the same browser commandId is a stable idempotency key across retries", () => {
    const commandId = crypto.randomUUID();
    const a = buildOperatorMeta(ACTOR, "publishProduct", commandId);
    const b = buildOperatorMeta(ACTOR, "publishProduct", commandId);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    // A fresh requestId per attempt, but the same idempotency key.
    expect(a.requestId).not.toBe(b.requestId);
  });

  test("reads mint distinct server-side commandIds (no browser idempotency)", () => {
    const first = buildOperatorMeta(ACTOR, "listProducts", crypto.randomUUID());
    const second = buildOperatorMeta(ACTOR, "listProducts", crypto.randomUUID());
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  test("a non-UUID commandId is rejected before any RPC is built", () => {
    expect(() => buildOperatorMeta(ACTOR, "createProduct", "not-a-uuid")).toThrow(/UUID/);
  });
});
