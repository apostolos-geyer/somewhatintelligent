import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { describeThrown, getRequestLog, requireRequestLog, withCanonicalLog } from "../index";

const baseCtx = {
  service: "test_service",
  event: "rpc",
  operation: "test.op",
  requestId: "req_01",
  actorKind: "user",
  actorId: "user_01",
  callerApp: "test_app",
};

let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("withCanonicalLog", () => {
  test("emits one info-level line on normal return with outcome=ok", async () => {
    const value = await withCanonicalLog(baseCtx, async () => 42);
    expect(value).toBe(42);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    const line = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(line).toMatchObject({
      service: "test_service",
      event: "rpc",
      operation: "test.op",
      outcome: "ok",
      request_id: "req_01",
      caller_app: "test_app",
      actor_kind: "user",
      actor_id: "user_01",
    });
    expect(typeof line.duration_ms).toBe("number");
    expect(typeof line.time).toBe("string");
  });

  test("emits at error level when outcome is in errorOutcomes set", async () => {
    await withCanonicalLog(baseCtx, async (log) => {
      log.outcome("backend_unavailable");
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({ outcome: "backend_unavailable" });
  });

  test("emits at info level for non-error outcomes (e.g. expected client errors)", async () => {
    await withCanonicalLog(baseCtx, async (log) => {
      log.outcome("not_found");
    });
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ outcome: "not_found" });
  });

  test("on throw: emits internal_error at error level + rethrows", async () => {
    await expect(
      withCanonicalLog(baseCtx, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "boom",
    });
  });

  test("merges builder.add() fields into the line", async () => {
    await withCanonicalLog(baseCtx, async (log) => {
      log.add({ resource_id: "res_01", part_number: 3 });
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      resource_id: "res_01",
      part_number: 3,
    });
  });

  test("strips forbidden fields by exact name and prefix", async () => {
    await withCanonicalLog(baseCtx, async (log) => {
      log.add({
        password: "hunter2",
        cookie: "session=abc",
        R2_BUCKET: "secret",
        S3_ACCESS_KEY_ID: "AKIA...",
        safe_field: "kept",
      });
    });
    const line = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(line.password).toBeUndefined();
    expect(line.cookie).toBeUndefined();
    expect(line.R2_BUCKET).toBeUndefined();
    expect(line.S3_ACCESS_KEY_ID).toBeUndefined();
    expect(line.safe_field).toBe("kept");
  });

  test("custom errorOutcomes / forbiddenFields override defaults", async () => {
    await withCanonicalLog(
      {
        ...baseCtx,
        errorOutcomes: new Set(["custom_failure"]),
        forbiddenFields: new Set(["my_secret"]),
        forbiddenPrefixes: ["INTERNAL_"],
      },
      async (log) => {
        log.add({ my_secret: "x", INTERNAL_KEY: "y", password: "still-here" });
        log.outcome("custom_failure");
      },
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const line = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(line.my_secret).toBeUndefined();
    expect(line.INTERNAL_KEY).toBeUndefined();
    expect(line.password).toBe("still-here"); // default list overridden
  });

  test("duration_ms reflects elapsed time", async () => {
    await withCanonicalLog(baseCtx, async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const line = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(line.duration_ms).toBeGreaterThanOrEqual(15);
  });

  test("last builder.outcome() call wins", async () => {
    await withCanonicalLog(baseCtx, async (log) => {
      log.outcome("first");
      log.outcome("second");
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ outcome: "second" });
  });
});

describe("AsyncLocalStorage propagation", () => {
  test("getRequestLog() returns the active builder inside scope", async () => {
    let captured: ReturnType<typeof getRequestLog> = null;
    await withCanonicalLog(baseCtx, async () => {
      captured = getRequestLog();
    });
    expect(captured).not.toBeNull();
  });

  test("getRequestLog() returns null outside any scope", () => {
    expect(getRequestLog()).toBeNull();
  });

  test("requireRequestLog() throws outside any scope", () => {
    expect(() => requireRequestLog()).toThrow(/outside any withCanonicalLog scope/);
  });

  test("fields accrued via getRequestLog() in nested awaits land on the line", async () => {
    async function deep() {
      await new Promise((r) => setTimeout(r, 5));
      requireRequestLog().add({ from_deep: true });
    }
    async function middle() {
      requireRequestLog().add({ from_middle: 1 });
      await deep();
    }
    await withCanonicalLog(baseCtx, async () => {
      await middle();
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      from_middle: 1,
      from_deep: true,
    });
  });

  test("outcome set via getRequestLog() in deep call is honored", async () => {
    async function deep() {
      requireRequestLog().outcome("not_found");
    }
    await withCanonicalLog(baseCtx, async () => {
      await deep();
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ outcome: "not_found" });
  });

  test("nested withCanonicalLog scopes are independent (inner does not leak to outer)", async () => {
    await withCanonicalLog({ ...baseCtx, operation: "outer" }, async (outerLog) => {
      outerLog.add({ at: "outer" });
      await withCanonicalLog({ ...baseCtx, operation: "inner" }, async (innerLog) => {
        innerLog.add({ at: "inner" });
        // requireRequestLog inside inner scope returns inner's builder
        expect(requireRequestLog()).toBe(innerLog);
      });
      // Back in outer scope, requireRequestLog returns outer's builder
      expect(requireRequestLog()).toBe(outerLog);
    });
    expect(logSpy).toHaveBeenCalledTimes(2);
    const innerLine = logSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).operation === "inner",
    )![0] as Record<string, unknown>;
    const outerLine = logSpy.mock.calls.find(
      (c: unknown[]) => (c[0] as Record<string, unknown>).operation === "outer",
    )![0] as Record<string, unknown>;
    expect(innerLine.at).toBe("inner");
    expect(outerLine.at).toBe("outer");
    // Outer line does NOT carry the inner field
    expect(outerLine.from_inner).toBeUndefined();
  });
});

describe("describeThrown", () => {
  test("Error → message + stack", () => {
    const err = new Error("boom");
    const d = describeThrown(err);
    expect(d.message).toBe("boom");
    expect(d.stack).toBe(err.stack);
  });

  test("thrown Response → named by status, never '[object Response]'", () => {
    const d = describeThrown(new Response(null, { status: 307 }));
    expect(d.message).toBe("thrown Response (status 307)");
    expect(d.stack).toBeUndefined();
  });

  test("plain object → JSON, never '[object Object]'", () => {
    expect(describeThrown({ isNotFound: true }).message).toBe('{"isNotFound":true}');
  });

  test("primitive → String()", () => {
    expect(describeThrown("nope").message).toBe("nope");
  });
});

describe("withCanonicalLog thrown-Response serialization", () => {
  test("a thrown Response emits a readable error_message", async () => {
    await expect(
      withCanonicalLog(baseCtx, async () => {
        throw new Response(null, { status: 307, headers: { location: "/sign-in" } });
      }),
    ).rejects.toBeInstanceOf(Response);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "thrown Response (status 307)",
      error_stack: "thrown Response (status 307)",
    });
  });
});
