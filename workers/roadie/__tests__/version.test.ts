/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { SELF } from "cloudflare:test";

// /__version — the only HTTP surface roadie's default fetch exposes
// (everything else stays the ADR-RD-001 404; consumers use service-binding
// RPC). Values are ship-time-injected vars (WORKER_VERSION/WORKER_COMMIT via
// scripts/deploy-worker.sh); tests run un-injected, so the kit fallbacks are
// the expected payload.
describe("version endpoint", () => {
  test("GET /__version returns the roadie version payload", async () => {
    const res = await SELF.fetch("http://localhost/__version");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, string>;
    expect(body.worker).toBe("roadie");
    expect(body.version).toBe("0.0.0-dev");
    expect(body.commit).toBe("unknown");
    expect(typeof body.environment).toBe("string");
  });

  test("every other path keeps the ADR-RD-001 404", async () => {
    const res = await SELF.fetch("http://localhost/anything-else");
    expect(res.status).toBe(404);
  });

  test("POST /__version is not intercepted (stays 404)", async () => {
    const res = await SELF.fetch("http://localhost/__version", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
