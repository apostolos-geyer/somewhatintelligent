import { SELF, env } from "cloudflare:test";

beforeEach(() => {
  env.ROUTES = JSON.stringify({
    routes: [{ binding: "WWW", host: "platform.test", path: "/" }],
  });
});

describe("proxy / dispatch", () => {
  test("matched host /  → upstream WWW receives the request (any path under root mount)", async () => {
    const res = await SELF.fetch("https://platform.test/anything");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/anything");
  });

  test("redirect from upstream is forwarded with Location preserved (root mount)", async () => {
    const res = await SELF.fetch("https://platform.test/api/redirect", { redirect: "manual" });
    expect(res.status).toBe(302);
    // Default mode is passthrough — Location is forwarded verbatim from the
    // upstream stub (`/somewhere`). In dev the prior implementation would
    // have absolutified this to `http://127.0.0.1:<port>/somewhere`, leaking
    // workerd's bind address back to the browser; that bug doesn't apply
    // here since passthrough doesn't touch Location at all.
    expect(res.headers.get("location")).toBe("/somewhere");
  });

  test("non-html upstream body is passed through unchanged", async () => {
    const res = await SELF.fetch("https://platform.test/api/json");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  test("unmatched host returns 404 (no fall-through fetch)", async () => {
    const res = await SELF.fetch("https://nope.test/anything");
    expect(res.status).toBe(404);
  });
});
