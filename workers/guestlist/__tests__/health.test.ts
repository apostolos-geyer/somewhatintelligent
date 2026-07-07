import { SELF } from "cloudflare:test";

describe("Health / Smoke", () => {
  test("GET /health returns status ok", async () => {
    const res = await SELF.fetch("http://localhost/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", service: "guestlist" });
  });

  test("GET /api/auth/ok returns 200 (Better Auth mounted)", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/ok");
    expect(res.status).toBe(200);
  });
});
