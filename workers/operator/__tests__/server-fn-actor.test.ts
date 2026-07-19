import { type } from "arktype";
import { isValid } from "@somewhatintelligent/kit/ids";
import { commandIdSchema, deriveIdempotencyKey, type OperatorActor } from "@si/contracts";
import { buildOperatorMeta } from "../src/lib/server-fn-actor";

// OperatorMeta derivation contract (RFC-0001 D7). The browser supplies ONLY an
// opaque UUID commandId; actor/requestId/idempotencyKey are server-derived and
// can never be asserted or overridden by the browser.

const ACTOR: OperatorActor = { sub: "access-sub-1", email: "apostoli@example.com" };

describe("buildOperatorMeta", () => {
  test("derives idempotencyKey as <actor.sub>:<action>:<commandId>", () => {
    const commandId = crypto.randomUUID();
    const meta = buildOperatorMeta(ACTOR, "product.create", commandId);

    expect(meta.idempotencyKey).toBe(`access-sub-1:product.create:${commandId}`);
    expect(meta.idempotencyKey).toBe(deriveIdempotencyKey(ACTOR.sub, "product.create", commandId));
  });

  test("carries the server actor and mints a fresh ULID requestId", () => {
    const meta = buildOperatorMeta(ACTOR, "product.delete", crypto.randomUUID());

    expect(meta.actor).toEqual(ACTOR);
    expect(isValid(meta.requestId)).toBe(true);
  });

  test("rejects a commandId that is not a UUID", () => {
    expect(() => buildOperatorMeta(ACTOR, "product.create", "not-a-uuid")).toThrow(/UUID/);
  });

  test("a browser-forged actor/meta cannot reach the derived meta", () => {
    // A hostile browser payload smuggling actor + meta fields alongside the one
    // legitimate field (commandId). buildOperatorMeta takes actor as a SEPARATE
    // server argument, so the forged fields are structurally unreachable.
    const forged = {
      commandId: crypto.randomUUID(),
      input: { name: "x" },
      actor: { sub: "attacker", email: "attacker@evil.test" },
      requestId: "forged-request-id",
      idempotencyKey: "attacker:product.create:forged",
    };

    const meta = buildOperatorMeta(ACTOR, "product.create", forged.commandId);

    expect(meta.actor).toEqual(ACTOR);
    expect(meta.actor.sub).not.toBe("attacker");
    expect(meta.requestId).not.toBe(forged.requestId);
    expect(meta.idempotencyKey).toBe(`access-sub-1:product.create:${forged.commandId}`);
    expect(meta.idempotencyKey).not.toBe(forged.idempotencyKey);
  });
});

describe("commandIdSchema (the only browser-supplied field)", () => {
  test("accepts a UUID and rejects anything else", () => {
    const uuid = crypto.randomUUID();
    expect(commandIdSchema(uuid)).toBe(uuid);
    expect(commandIdSchema("not-a-uuid") instanceof type.errors).toBe(true);
    // The browser field is a bare string — it carries no actor/meta structure.
    expect(commandIdSchema({ sub: "attacker" }) instanceof type.errors).toBe(true);
  });
});
