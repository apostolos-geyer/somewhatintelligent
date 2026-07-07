import { describe, expect, test } from "vite-plus/test";
import { VERSION_PATH, handleVersionRequest, versionInfo, versionResponse } from "../index";

const req = (url: string, method = "GET") => new Request(url, { method });

describe("versionInfo", () => {
  test("reads ship-time vars + ENVIRONMENT from env", () => {
    expect(
      versionInfo({
        worker: "guestlist",
        env: { WORKER_VERSION: "1.2.3", WORKER_COMMIT: "abc1234", ENVIRONMENT: "staging" },
      }),
    ).toEqual({
      worker: "guestlist",
      version: "1.2.3",
      commit: "abc1234",
      environment: "staging",
    });
  });

  test("falls back safely when nothing is injected", () => {
    expect(versionInfo({ worker: "bouncer" })).toEqual({
      worker: "bouncer",
      version: "0.0.0-dev",
      commit: "unknown",
      environment: "development",
    });
  });

  test("ignores empty-string and non-string vars", () => {
    const info = versionInfo({
      worker: "roadie",
      env: { WORKER_VERSION: "", WORKER_COMMIT: 42, ENVIRONMENT: null },
    });
    expect(info.version).toBe("0.0.0-dev");
    expect(info.commit).toBe("unknown");
    expect(info.environment).toBe("development");
  });

  test("tolerates a non-object env", () => {
    expect(versionInfo({ worker: "promoter", env: "nope" }).version).toBe("0.0.0-dev");
  });

  test("overrides win over env vars (vite-define apps)", () => {
    const info = versionInfo({
      worker: "identity",
      env: { WORKER_VERSION: "9.9.9", ENVIRONMENT: "staging" },
      overrides: { version: "1.0.0", commit: "def5678" },
    });
    expect(info.version).toBe("1.0.0");
    expect(info.commit).toBe("def5678");
    expect(info.environment).toBe("staging"); // un-overridden field still reads env
  });
});

describe("versionResponse", () => {
  test("serializes as uncacheable JSON", async () => {
    const res = versionResponse({
      worker: "bouncer",
      version: "1.0.0",
      commit: "abc",
      environment: "production",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      worker: "bouncer",
      version: "1.0.0",
      commit: "abc",
      environment: "production",
    });
  });
});

describe("handleVersionRequest", () => {
  test(`answers GET ${VERSION_PATH} on any host`, async () => {
    const res = handleVersionRequest(req("https://anything.example/__version"), {
      worker: "bouncer",
      env: { ENVIRONMENT: "staging" },
    });
    expect(res).not.toBeNull();
    expect(((await res!.json()) as { worker: string }).worker).toBe("bouncer");
  });

  test("returns null for other paths (routing proceeds)", () => {
    expect(
      handleVersionRequest(req("https://x.example/health"), { worker: "guestlist" }),
    ).toBeNull();
    // No prefix matching — only exact paths answer.
    expect(
      handleVersionRequest(req("https://x.example/__version/extra"), { worker: "guestlist" }),
    ).toBeNull();
  });

  test("returns null for non-GET/HEAD methods", () => {
    expect(
      handleVersionRequest(req("https://x.example/__version", "POST"), { worker: "roadie" }),
    ).toBeNull();
  });

  test("answers HEAD", () => {
    expect(
      handleVersionRequest(req("https://x.example/__version", "HEAD"), { worker: "roadie" }),
    ).not.toBeNull();
  });

  test("extra mounted paths answer (guestlist behind bouncer's /api passthrough)", async () => {
    const opts = {
      worker: "guestlist",
      paths: ["/__version", "/api/__version"],
    } as const;
    const direct = handleVersionRequest(req("https://x.example/__version"), opts);
    const mounted = handleVersionRequest(req("https://x.example/api/__version"), opts);
    expect(direct).not.toBeNull();
    expect(mounted).not.toBeNull();
    expect(((await mounted!.json()) as { worker: string }).worker).toBe("guestlist");
  });
});
