/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { SELF } from "cloudflare:test";

// /__version — the only HTTP surface vault's default fetch exposes
// (binding-only service: everything else is a 404; consumers use
// service-binding RPC).
describe("version endpoint", () => {
  test("GET /__version returns the vault version payload", async () => {
    const res = await SELF.fetch("http://localhost/__version");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, string>;
    expect(body.worker).toBe("vault");
    expect(body.version).toBe("0.0.0-dev");
    expect(body.commit).toBe("unknown");
  });

  test("every other path stays 404", async () => {
    const res = await SELF.fetch("http://localhost/anything-else");
    expect(res.status).toBe(404);
  });
});
