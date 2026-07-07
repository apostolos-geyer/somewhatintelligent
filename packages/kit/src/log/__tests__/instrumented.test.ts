import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { requireRequestLog } from "../index";
import { instrumented, logged } from "../instrumented";

interface FakeMeta {
  requestId: string;
  actor: { kind: "user" | "service" | "anonymous"; userId?: string; serviceName?: string };
  callerApp?: string;
}

function actorId(actor: FakeMeta["actor"]): string | null {
  if (actor.kind === "user") return actor.userId ?? null;
  if (actor.kind === "service") return actor.serviceName ?? null;
  return null;
}

const baseMeta: FakeMeta = {
  requestId: "req_01",
  actor: { kind: "user", userId: "user_01" },
  callerApp: "test_caller",
};

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

function makeConfig() {
  return {
    service: "fake_service",
    resolveContext: ({ args }: { methodName: string; args: unknown[]; instance: unknown }) => {
      const meta = args[1] as FakeMeta;
      return {
        requestId: meta.requestId,
        actorKind: meta.actor.kind,
        actorId: actorId(meta.actor),
        callerApp: meta.callerApp,
      };
    },
    deriveOutcome: (ret: unknown) => {
      const r = ret as { ok: boolean; error?: string };
      return r.ok ? "ok" : r.error;
    },
  };
}

describe("@instrumented class decorator", () => {
  test("wraps every async method on the prototype", async () => {
    @instrumented(makeConfig())
    class Service {
      async doThing(input: { id: string }, _meta: FakeMeta) {
        return { ok: true, value: input.id };
      }
      async otherThing(_input: object, _meta: FakeMeta) {
        return { ok: true, value: "other" };
      }
    }

    const svc = new Service();
    await svc.doThing({ id: "x" }, baseMeta);
    await svc.otherThing({}, baseMeta);

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      service: "fake_service",
      event: "rpc",
      operation: "fake_service.doThing",
      outcome: "ok",
      request_id: "req_01",
      actor_kind: "user",
      actor_id: "user_01",
      caller_app: "test_caller",
    });
    expect(logSpy.mock.calls[1]![0]).toMatchObject({
      operation: "fake_service.otherThing",
    });
  });

  test("derives outcome from return value via deriveOutcome", async () => {
    @instrumented(makeConfig())
    class Service {
      async failing(_i: object, _m: FakeMeta) {
        return { ok: false, error: "not_found" };
      }
    }

    await new Service().failing({}, baseMeta);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ outcome: "not_found" });
  });

  test("emits internal_error + rethrows on throw", async () => {
    @instrumented(makeConfig())
    class Service {
      async kaboom(_i: object, _m: FakeMeta): Promise<{ ok: boolean }> {
        throw new Error("boom");
      }
    }

    await expect(new Service().kaboom({}, baseMeta)).rejects.toThrow("boom");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "boom",
      operation: "fake_service.kaboom",
    });
  });

  test("ALS scope is open inside method body — requireRequestLog().add works", async () => {
    @instrumented(makeConfig())
    class Service {
      async doThing(input: { id: string }, _meta: FakeMeta) {
        requireRequestLog().add({ resource_id: input.id, custom: "field" });
        return { ok: true };
      }
    }

    await new Service().doThing({ id: "res_01" }, baseMeta);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      resource_id: "res_01",
      custom: "field",
    });
  });

  test("@logged.skip excludes method from instrumentation", async () => {
    @instrumented(makeConfig())
    class Service {
      async tracked(_i: object, _m: FakeMeta) {
        return { ok: true };
      }

      @logged.skip
      async healthCheck() {
        return { status: "healthy" };
      }
    }

    const svc = new Service();
    await svc.tracked({}, baseMeta);
    await svc.healthCheck();

    // Only the tracked() call emits.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ operation: "fake_service.tracked" });
  });

  test("operation override via resolveContext is respected", async () => {
    @instrumented({
      service: "fake_service",
      resolveContext: ({ methodName, args }) => {
        const meta = args[1] as FakeMeta;
        return {
          operation: `custom.${methodName}.override`,
          requestId: meta.requestId,
          actorKind: meta.actor.kind,
          actorId: actorId(meta.actor),
          callerApp: meta.callerApp,
        };
      },
    })
    class Service {
      async someOp(_i: object, _m: FakeMeta) {
        return { ok: true };
      }
    }

    await new Service().someOp({}, baseMeta);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      operation: "custom.someOp.override",
    });
  });

  test("preserves return value through wrapper", async () => {
    @instrumented(makeConfig())
    class Service {
      async doThing(_i: object, _m: FakeMeta) {
        return { ok: true, value: 42 };
      }
    }

    const result = await new Service().doThing({}, baseMeta);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  test("works on classes that extend a base class (own-method only)", async () => {
    class Base {
      async baseMethod() {
        return { ok: true };
      }
    }

    @instrumented(makeConfig())
    class Derived extends Base {
      async ownMethod(_i: object, _m: FakeMeta) {
        return { ok: true, value: "own" };
      }
    }

    const d = new Derived();
    await d.ownMethod({}, baseMeta);
    await d.baseMethod();

    // Only ownMethod is wrapped; Base.baseMethod is on Base.prototype, not Derived.prototype.
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ operation: "fake_service.ownMethod" });
  });

  test("multiple instances share wrapped prototype methods", async () => {
    @instrumented(makeConfig())
    class Service {
      async doThing(_i: object, _m: FakeMeta) {
        return { ok: true };
      }
    }

    const a = new Service();
    const b = new Service();
    await a.doThing({}, baseMeta);
    await b.doThing({}, baseMeta);
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  test("onError converts throws to a returned value (Result-style APIs)", async () => {
    @instrumented({
      ...makeConfig(),
      onError: (e: unknown) => ({
        ok: false,
        error: "internal_error",
        message: e instanceof Error ? e.message : String(e),
      }),
    })
    class Service {
      async kaboom(_i: object, _m: FakeMeta): Promise<{ ok: boolean }> {
        throw new Error("boom");
      }
    }

    const result = await new Service().kaboom({}, baseMeta);
    // Throw was converted, NOT propagated.
    expect(result).toEqual({ ok: false, error: "internal_error", message: "boom" });
    // Line still emitted at error level with internal_error outcome.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "boom",
    });
  });

  test("onError unset → throws still propagate (default behavior preserved)", async () => {
    @instrumented(makeConfig())
    class Service {
      async kaboom(_i: object, _m: FakeMeta): Promise<{ ok: boolean }> {
        throw new Error("rethrown");
      }
    }
    await expect(new Service().kaboom({}, baseMeta)).rejects.toThrow("rethrown");
  });

  // A resolveContext failure runs BEFORE the main scope opens. It must NOT slip
  // the net as a silent `outcome:exception` with empty logs (the roadie
  // caller_app-misconfig hole) — it has to emit an actionable canonical line.
  test("resolveContext throw emits a canonical error line + honors onError", async () => {
    @instrumented({
      service: "fake_service",
      resolveContext: () => {
        throw new Error("ROADIE binding missing props.callerApp");
      },
      onError: (e: unknown) => ({
        ok: false,
        error: "internal_error",
        message: e instanceof Error ? e.message : String(e),
      }),
    })
    class Service {
      async doThing(_i: object, _m: FakeMeta): Promise<{ ok: boolean }> {
        return { ok: true };
      }
    }

    const result = await new Service().doThing({}, baseMeta);
    // Converted via onError, not a raw throw.
    expect(result).toMatchObject({ ok: false, error: "internal_error" });
    // ...and the failure is LOGGED with a phase marker + message, not silent.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      service: "fake_service",
      operation: "fake_service.doThing",
      outcome: "internal_error",
      error_phase: "resolve_context",
      error_message: "ROADIE binding missing props.callerApp",
    });
  });

  test("resolveContext throw with no onError still emits a line, then rethrows", async () => {
    @instrumented({
      service: "fake_service",
      resolveContext: () => {
        throw new Error("no ctx");
      },
    })
    class Service {
      async doThing(_i: object, _m: FakeMeta): Promise<{ ok: boolean }> {
        return { ok: true };
      }
    }
    await expect(new Service().doThing({}, baseMeta)).rejects.toThrow("no ctx");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({ error_phase: "resolve_context" });
  });
});
