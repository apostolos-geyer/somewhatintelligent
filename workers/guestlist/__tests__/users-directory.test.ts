/**
 * Donor's /api/users/search + /api/users/by-ids suite, ported to the RPC
 * surface those routes became.
 */
import { env } from "cloudflare:test";
import { signUpVerified, uniqueEmail, TEST_EMAIL_DOMAIN } from "./helpers";

describe("searchUsers RPC", () => {
  test("prefix/substring match on name returns the user", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Caller One",
      email: uniqueEmail("caller"),
      password: "Caller1234!",
    });
    const handle = `bobby${Date.now()}`;
    const target = await signUpVerified({
      name: handle,
      email: uniqueEmail("target"),
      password: "Target1234!",
    });
    const res = await env.GL_RPC.searchUsers({ cookie: caller.cookies, query: handle.slice(0, 4) });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.some((u) => u.id === target.userId)).toBe(true);
  });

  test("substring match on email returns the user", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Caller Two",
      email: uniqueEmail("caller2"),
      password: "Caller1234!",
    });
    const marker = `acme${Date.now()}`;
    const target = await signUpVerified({
      name: "Acme Engineer",
      email: `engineer-${marker}@${TEST_EMAIL_DOMAIN}`,
      password: "Target1234!",
    });
    const res = await env.GL_RPC.searchUsers({ cookie: caller.cookies, query: marker });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.some((u) => u.id === target.userId)).toBe(true);
  });

  test("empty and whitespace-only queries return []", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Empty Caller",
      email: uniqueEmail("empty"),
      password: "Caller1234!",
    });
    for (const query of ["", "   "]) {
      const res = await env.GL_RPC.searchUsers({ cookie: caller.cookies, query });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("unreachable");
      expect(res.users).toEqual([]);
    }
  });

  test("limit is honored", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Limit Caller",
      email: uniqueEmail("limit"),
      password: "Caller1234!",
    });
    const stamp = `lmt${Date.now()}`;
    for (let i = 0; i < 4; i++) {
      await signUpVerified({
        name: `${stamp}-user-${i}`,
        email: uniqueEmail(`${stamp}-${i}`),
        password: "Member1234!",
      });
    }
    const res = await env.GL_RPC.searchUsers({ cookie: caller.cookies, query: stamp, limit: 2 });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.length).toBe(2);
  });

  test("requires an authenticated session", async () => {
    const res = await env.GL_RPC.searchUsers({ cookie: "", query: "anything" });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });
});

describe("getUsersByIds RPC", () => {
  test("returns subset for missing ids, preserves input order", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Batch Caller",
      email: uniqueEmail("batch"),
      password: "Caller1234!",
    });
    const a = await signUpVerified({
      name: "User A",
      email: uniqueEmail("a"),
      password: "Member1234!",
    });
    const b = await signUpVerified({
      name: "User B",
      email: uniqueEmail("b"),
      password: "Member1234!",
    });
    const res = await env.GL_RPC.getUsersByIds({
      cookie: caller.cookies,
      ids: [b.userId, "nonexistent-id-xyz", a.userId],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.map((u) => u.id)).toEqual([b.userId, a.userId]);
  });

  test("empty ids returns []", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Empty Batch",
      email: uniqueEmail("ebatch"),
      password: "Caller1234!",
    });
    const res = await env.GL_RPC.getUsersByIds({ cookie: caller.cookies, ids: [] });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users).toEqual([]);
  });

  test("requires an authenticated session", async () => {
    const res = await env.GL_RPC.getUsersByIds({ cookie: "", ids: ["x"] });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });
});
