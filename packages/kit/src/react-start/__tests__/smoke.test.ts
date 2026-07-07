import { describe, expect, test } from "vite-plus/test";
import {
  createGuestlistFactory,
  createLoggingFunctionMiddleware,
  createRequestLogger,
  createRoadieFactory,
  createSessionFactory,
} from "../index";
import { createReactStartAuthProvider } from "../client";
import { createAuthContext } from "../../react";

type FakeSession = { user: { id: string; email: string; role?: string | null } };

// Smoke: each factory returns a TSS middleware object with an `options.server`
// callback. Behavioural coverage lives in `kit/log` and `kit/request-context`
// — these tests exist to catch wiring regressions (missing peer-dep, broken
// re-export, factory signature drift).
describe("kit/react-start factories return TSS middleware objects", () => {
  test("createLoggingFunctionMiddleware", () => {
    const m = createLoggingFunctionMiddleware({ service: "test" });
    expect(m).toBeDefined();
    expect(typeof (m as { options?: { server?: unknown } }).options?.server).toBe("function");
  });

  test("createRequestLogger", () => {
    const m = createRequestLogger({ service: "test" });
    expect(m).toBeDefined();
    expect(typeof (m as { options?: { server?: unknown } }).options?.server).toBe("function");
  });
});

describe("kit/react-start service-client factories", () => {
  test("createGuestlistFactory returns a callable", () => {
    const getGuestlist = createGuestlistFactory({
      callerApp: "test",
      createClient: () => ({ ok: true }),
      fetcher: () => globalThis.fetch,
    });
    expect(typeof getGuestlist).toBe("function");
  });

  test("createRoadieFactory returns a callable", () => {
    const getRoadie = createRoadieFactory({
      callerApp: "test",
      createClient: () => ({ ok: true }),
      getBinding: () => ({}) as unknown,
    });
    expect(typeof getRoadie).toBe("function");
  });

  test("createSessionFactory returns a createServerOnlyFn-wrapped getSession", () => {
    const getSession = createSessionFactory<FakeSession>({
      getGuestlistFallback: async () => null,
    });
    expect(typeof getSession).toBe("function");
  });
});

describe("kit/react-start auth-provider factory", () => {
  test("createReactStartAuthProvider returns a React component", () => {
    const authContext = createAuthContext<FakeSession>();
    const Provider = createReactStartAuthProvider<FakeSession>({
      authContext,
      loadSession: async () => null,
    });
    expect(typeof Provider).toBe("function");
  });
});

describe("kit/react createAuthContext", () => {
  test("returns { Context, useAuth, BaseAuthProvider }", () => {
    const ctx = createAuthContext<FakeSession>();
    expect(ctx.Context).toBeDefined();
    expect(typeof ctx.useAuth).toBe("function");
    expect(typeof ctx.BaseAuthProvider).toBe("function");
  });
});
