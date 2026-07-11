import { SELF } from "cloudflare:test";

// /__version — answered at the worker boundary in both spellings: direct
// and through bouncer's /api passthrough mount (prefix not stripped).
// The payload is the published @somewhatintelligent/guestlist package's
// release stamp (version.gen.ts, stamped at publish) — the package IS the
// versioned artifact; the old deploy-var placeholders are gone. Assert the
// contract's shape, not an exact pin, so package bumps don't break this.
describe("Version endpoint", () => {
  test("GET /__version returns the guestlist version payload", async () => {
    const res = await SELF.fetch("http://localhost/__version");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, string>;
    expect(body.worker).toBe("guestlist");
    expect(body.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(body.version).not.toBe("0.0.0-dev");
    expect(body.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof body.environment).toBe("string");
  });

  test("GET /api/__version (the bouncer-mounted spelling) answers too", async () => {
    const res = await SELF.fetch("http://localhost/api/__version");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { worker: string }).worker).toBe("guestlist");
  });

  test("POST /__version is not intercepted", async () => {
    const res = await SELF.fetch("http://localhost/__version", { method: "POST" });
    expect(res.status).not.toBe(200);
  });
});
