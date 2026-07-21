import { deriveIdempotencyKey, type OperatorActor } from "@si/contracts";
import { buildOperatorMeta } from "../src/lib/server-fn-actor";

// The OperatorMeta derivation the Publisher-owned modules (Texts / Software /
// Pages / Media) rely on (RFC-0001 D8/D13). Each mutation server fn builds its
// call as `{ input, meta: buildOperatorMeta(context.actor, "<action>", commandId) }`
// where `<action>` matches the PublisherOperator method name so the audit event
// action stays aligned with the RPC. These lock the action strings and the
// `<sub>:<action>:<commandId>` idempotency contract.

const ACTOR: OperatorActor = { sub: "op-sub-9", email: "op@example.com" };

// Confirm-side (browser supplies commandId) mutation actions, per contract method.
const MUTATION_ACTIONS = [
  "createText",
  "saveTextDraft",
  "publishText",
  "retireText",
  "deleteText",
  "deleteTextRelease",
  "createSoftware",
  "saveSoftwareDraft",
  "publishSoftware",
  "retireSoftware",
  "deleteSoftware",
  "createPage",
  "savePageDraft",
  "publishPage",
  "deletePage",
  "deletePageRelease",
  "deleteMedia",
] as const;

describe("publisher module OperatorMeta derivation", () => {
  test("mutations namespace the browser commandId as <sub>:<action>:<commandId>", () => {
    for (const action of MUTATION_ACTIONS) {
      const commandId = crypto.randomUUID();
      const meta = buildOperatorMeta(ACTOR, action, commandId);
      expect(meta.idempotencyKey).toBe(`op-sub-9:${action}:${commandId}`);
      expect(meta.idempotencyKey).toBe(deriveIdempotencyKey(ACTOR.sub, action, commandId));
      expect(meta.actor).toEqual(ACTOR);
    }
  });

  test("the same commandId is a stable idempotency key across confirm retries", () => {
    const commandId = crypto.randomUUID();
    const a = buildOperatorMeta(ACTOR, "deleteText", commandId);
    const b = buildOperatorMeta(ACTOR, "deleteText", commandId);
    expect(a.idempotencyKey).toBe(b.idempotencyKey);
    expect(a.requestId).not.toBe(b.requestId);
  });

  test("deletion plans mint distinct server-side commandIds (no browser idempotency)", () => {
    const first = buildOperatorMeta(ACTOR, "planTextDeletion", crypto.randomUUID());
    const second = buildOperatorMeta(ACTOR, "planTextDeletion", crypto.randomUUID());
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
  });

  test("a non-UUID commandId is rejected before any RPC is built", () => {
    expect(() => buildOperatorMeta(ACTOR, "createText", "not-a-uuid")).toThrow(/UUID/);
  });
});
