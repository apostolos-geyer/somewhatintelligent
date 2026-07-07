import { describe, expect, test } from "vite-plus/test";
import {
  getActorId,
  getActorKind,
  getCallerApp,
  getRequestContext,
  getRequestId,
  withRequestContext,
} from "../index";

describe("withRequestContext / getRequestContext", () => {
  test("getRequestContext() returns the active context inside scope", async () => {
    let captured: ReturnType<typeof getRequestContext> = null;
    await withRequestContext({ requestId: "req_01" }, async () => {
      captured = getRequestContext();
    });
    expect(captured).toEqual({ requestId: "req_01" });
  });

  test("getRequestContext() returns null outside any scope", () => {
    expect(getRequestContext()).toBeNull();
  });

  test("getRequestId() reads request_id from active scope", async () => {
    let id: string | null = null;
    await withRequestContext({ requestId: "req_42" }, async () => {
      id = getRequestId();
    });
    expect(id).toBe("req_42");
  });

  test("convenience readers return their respective fields", async () => {
    let captured: { kind: string | null; id: string | null; caller: string | null } | null = null;
    await withRequestContext(
      {
        requestId: "req_01",
        actorKind: "user",
        actorId: "user_123",
        callerApp: "chat",
      },
      async () => {
        captured = {
          kind: getActorKind(),
          id: getActorId(),
          caller: getCallerApp(),
        };
      },
    );
    expect(captured).toEqual({ kind: "user", id: "user_123", caller: "chat" });
  });

  test("scope propagates through nested awaits", async () => {
    async function deep() {
      await new Promise((r) => setTimeout(r, 5));
      return getRequestId();
    }
    async function middle() {
      return deep();
    }
    let result: string | null = null;
    await withRequestContext({ requestId: "req_deep" }, async () => {
      result = await middle();
    });
    expect(result).toBe("req_deep");
  });

  test("nested withRequestContext shadows outer", async () => {
    const ids: (string | null)[] = [];
    await withRequestContext({ requestId: "outer" }, async () => {
      ids.push(getRequestId());
      await withRequestContext({ requestId: "inner" }, async () => {
        ids.push(getRequestId());
      });
      ids.push(getRequestId());
    });
    expect(ids).toEqual(["outer", "inner", "outer"]);
  });

  test("readers return null for fields not set", async () => {
    let captured: { kind: string | null; id: string | null; caller: string | null } | null = null;
    await withRequestContext({ requestId: "req_01" }, async () => {
      captured = {
        kind: getActorKind(),
        id: getActorId(),
        caller: getCallerApp(),
      };
    });
    expect(captured).toEqual({ kind: null, id: null, caller: null });
  });
});
