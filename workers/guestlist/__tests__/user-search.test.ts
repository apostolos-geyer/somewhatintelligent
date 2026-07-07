import { SELF } from "cloudflare:test";
import { signUpVerified, uniqueEmail, GUESTLIST_DEV_ORIGIN, TEST_EMAIL_DOMAIN } from "./helpers";

const ORIGIN = GUESTLIST_DEV_ORIGIN;

type SearchHit = { id: string; name: string; email?: string; image?: string };

async function postJson(path: string, body: unknown, cookies: string | null): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/users/search", () => {
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
    const res = await postJson("/api/users/search", { query: handle.slice(0, 4) }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users.some((u) => u.id === target.userId)).toBe(true);
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
    const res = await postJson("/api/users/search", { query: marker }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users.some((u) => u.id === target.userId)).toBe(true);
  });

  test("empty query returns []", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Empty Caller",
      email: uniqueEmail("empty"),
      password: "Caller1234!",
    });
    const res = await postJson("/api/users/search", { query: "" }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users).toEqual([]);
  });

  test("whitespace-only query returns []", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "WS Caller",
      email: uniqueEmail("ws"),
      password: "Caller1234!",
    });
    const res = await postJson("/api/users/search", { query: "   " }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users).toEqual([]);
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
    const res = await postJson("/api/users/search", { query: stamp, limit: 2 }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users.length).toBe(2);
  });

  test("requires authenticated session (401 without cookies)", async () => {
    const res = await postJson("/api/users/search", { query: "anything" }, null);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/users/by-ids", () => {
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
    const missing = "nonexistent-id-xyz";
    const res = await postJson(
      "/api/users/by-ids",
      { ids: [b.userId, missing, a.userId] },
      caller.cookies,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users.map((u) => u.id)).toEqual([b.userId, a.userId]);
  });

  test("empty ids returns []", { timeout: 30_000 }, async () => {
    const caller = await signUpVerified({
      name: "Empty Batch",
      email: uniqueEmail("ebatch"),
      password: "Caller1234!",
    });
    const res = await postJson("/api/users/by-ids", { ids: [] }, caller.cookies);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: SearchHit[] };
    expect(body.users).toEqual([]);
  });

  test("requires authenticated session (401 without cookies)", async () => {
    const res = await postJson("/api/users/by-ids", { ids: ["x"] }, null);
    expect(res.status).toBe(401);
  });
});
