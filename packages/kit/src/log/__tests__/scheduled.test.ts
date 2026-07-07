import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { requireRequestLog } from "../index";
import { loggedJob } from "../scheduled";

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

describe("loggedJob", () => {
  test("emits event=job with synthesized requestId + service actor", async () => {
    const job = loggedJob({ service: "roadie", operation: "roadie.job.reap" }, async () => ({
      reaped: 7,
    }));

    const result = await job();
    expect(result).toEqual({ reaped: 7 });
    expect(logSpy).toHaveBeenCalledTimes(1);
    const line = logSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(line).toMatchObject({
      service: "roadie",
      event: "job",
      operation: "roadie.job.reap",
      outcome: "ok",
      actor_kind: "service",
      actor_id: "roadie",
    });
    // Default requestId is crypto.randomUUID — non-empty string.
    expect(typeof line.request_id).toBe("string");
    expect((line.request_id as string).length).toBeGreaterThan(8);
  });

  test("generateRequestId override is used", async () => {
    let count = 0;
    const job = loggedJob(
      {
        service: "roadie",
        operation: "roadie.job.x",
        generateRequestId: () => `custom_${++count}`,
      },
      async () => ({ ok: true }),
    );

    await job();
    await job();
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ request_id: "custom_1" });
    expect(logSpy.mock.calls[1]![0]).toMatchObject({ request_id: "custom_2" });
  });

  test("requireRequestLog().add inside handler captures domain fields", async () => {
    const job = loggedJob({ service: "roadie", operation: "roadie.job.reap" }, async () => {
      requireRequestLog().add({ reaped_count: 12, swept_grants: ["g1", "g2"] });
    });

    await job();
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      reaped_count: 12,
      swept_grants: ["g1", "g2"],
    });
  });

  test("throw → internal_error at error level + rethrow", async () => {
    const job = loggedJob({ service: "roadie", operation: "roadie.job.fail" }, async () => {
      throw new Error("scheduled task crashed");
    });

    await expect(job()).rejects.toThrow("scheduled task crashed");
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "scheduled task crashed",
    });
  });

  test("passes args through to handler", async () => {
    const job = loggedJob(
      { service: "roadie", operation: "roadie.job.passthrough" },
      async (a: number, b: string) => ({ a, b }),
    );

    const result = await job(7, "hello");
    expect(result).toEqual({ a: 7, b: "hello" });
  });

  test("resolveContext extra fields land on line", async () => {
    const job = loggedJob(
      {
        service: "roadie",
        operation: "roadie.job.with_caller",
        resolveContext: () => ({ callerApp: "roadie" }),
      },
      async () => undefined,
    );

    await job();
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      caller_app: "roadie",
    });
  });
});
