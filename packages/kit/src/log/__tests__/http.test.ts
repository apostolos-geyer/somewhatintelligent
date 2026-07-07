import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { requireRequestLog } from "../index";
import { withRequestLog } from "../http";

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

const baseConfig = {
  service: "guestlist",
  resolveContext: (req: Request) => ({
    requestId: req.headers.get("cf-request-id") ?? "fallback",
    actorKind: "anonymous",
    actorId: null,
  }),
};

describe("withRequestLog", () => {
  test("emits event=http line with method/path auto-added", async () => {
    const req = new Request("https://example.com/api/sign-in", {
      method: "POST",
      headers: { "cf-request-id": "req_42" },
    });

    await withRequestLog(baseConfig, req, async () => new Response("ok"));

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      service: "guestlist",
      event: "http",
      operation: "http.post",
      method: "POST",
      path: "/api/sign-in",
      request_id: "req_42",
    });
  });

  test("default operation derives from method", async () => {
    const get = new Request("https://example.com/x", { method: "GET" });
    const post = new Request("https://example.com/x", { method: "POST" });

    await withRequestLog(baseConfig, get, async () => new Response());
    await withRequestLog(baseConfig, post, async () => new Response());

    expect(logSpy.mock.calls[0]![0]).toMatchObject({ operation: "http.get" });
    expect(logSpy.mock.calls[1]![0]).toMatchObject({ operation: "http.post" });
  });

  test("deriveOperation override produces route-aware op names", async () => {
    const req = new Request("https://example.com/api/upload", { method: "POST" });
    await withRequestLog(
      {
        ...baseConfig,
        deriveOperation: (r) => `roadie.${new URL(r.url).pathname.split("/").pop()}`,
      },
      req,
      async () => new Response(),
    );
    expect(logSpy.mock.calls[0]![0]).toMatchObject({ operation: "roadie.upload" });
  });

  test("middleware can add status + outcome via the builder", async () => {
    const req = new Request("https://example.com/x", { method: "POST" });
    await withRequestLog(baseConfig, req, async (log) => {
      const status = 404;
      log.add({ status });
      log.outcome(`http_${status}`);
      return new Response(null, { status });
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      status: 404,
      outcome: "http_404",
    });
  });

  test("requireRequestLog inside fn captures domain fields", async () => {
    const req = new Request("https://example.com/x", { method: "POST" });
    await withRequestLog(baseConfig, req, async () => {
      requireRequestLog().add({ user_id: "u1", session_age_ms: 12345 });
      return new Response();
    });
    expect(logSpy.mock.calls[0]![0]).toMatchObject({
      user_id: "u1",
      session_age_ms: 12345,
    });
  });

  test("throw → internal_error + rethrow", async () => {
    const req = new Request("https://example.com/x", { method: "POST" });
    await expect(
      withRequestLog(baseConfig, req, async () => {
        throw new Error("kaboom");
      }),
    ).rejects.toThrow("kaboom");
    expect(errorSpy.mock.calls[0]![0]).toMatchObject({
      outcome: "internal_error",
      error_message: "kaboom",
    });
  });
});
