import { SELF } from "cloudflare:test";
import type { CookieSerializeOptions } from "cookie-es";
import { createGuestlistClient } from "../../src/client/guestlist";
import { signUpVerified, uniqueEmail, GUESTLIST_DEV_ORIGIN, COOKIE_PREFIX } from "../helpers";

const sessionTokenName = `${COOKIE_PREFIX}.session_token`;
const sessionDataName = `${COOKIE_PREFIX}.session_data`;

/**
 * Build a guestlist client wired to SELF so all traffic (Eden + Better Auth)
 * runs through the workerd service binding — same shape identity will use
 * in production against the real CF service binding.
 */
function createTestGuestlistClient(cookies: string) {
  return createGuestlistClient({
    baseURL: "http://localhost",
    fetchOptions: {
      customFetchImpl: ((input, init) => SELF.fetch(input, init)) as typeof fetch,
      onRequest(ctx) {
        const headers = new Headers(ctx.headers);
        headers.set("cookie", cookies);
        ctx.headers = headers;
      },
    },
  });
}

describe("createGuestlistClient", () => {
  let guestlist: ReturnType<typeof createTestGuestlistClient>;
  let testEmail: string;
  let testUserId: string;

  beforeAll(async () => {
    testEmail = uniqueEmail("client");
    const result = await signUpVerified({
      name: "Client Test User",
      email: testEmail,
      password: "Client1234!@#$",
    });
    testUserId = result.userId;
    guestlist = createTestGuestlistClient(result.cookies);
  });

  describe("auth (Better Auth)", () => {
    test("getSession returns signed-in user", async () => {
      const res = await guestlist.auth.getSession();
      expect(res.data).not.toBeNull();
      expect(res.data!.user.email).toBe(testEmail);
      expect(res.data!.user.role).toBe("user");
    });

    test("signIn.email works through client", async () => {
      const res = await guestlist.auth.signIn.email({
        email: testEmail,
        password: "Client1234!@#$",
        fetchOptions: { headers: { Origin: GUESTLIST_DEV_ORIGIN } },
      });
      expect(res.data).not.toBeNull();
      expect(res.data!.user.email).toBe(testEmail);
    });
  });

  describe("sugar helpers", () => {
    test("getSession maps to GuestlistSession", async () => {
      const session = await guestlist.getSession();
      expect(session).not.toBeNull();
      expect(session!.user.id).toBe(testUserId);
      expect(session!.user.email).toBe(testEmail);
    });
  });
});

describe("createGuestlistClient cookies adapter", () => {
  test("getAll() folds cookies into the outgoing Cookie header", async () => {
    let capturedCookieHeader: string | null = null;
    const client = createGuestlistClient({
      baseURL: "http://localhost",
      fetchOptions: {
        customFetchImpl: ((input, init) => {
          capturedCookieHeader = new Headers(init?.headers ?? undefined).get("cookie");
          return SELF.fetch(input, init);
        }) as typeof fetch,
      },
      cookies: {
        getAll: () => [
          { name: sessionTokenName, value: "abc123" },
          { name: sessionDataName, value: "xyz789" },
        ],
        setAll: () => {},
      },
    });
    await client.auth.getSession();
    expect(capturedCookieHeader).not.toBeNull();
    expect(capturedCookieHeader!).toContain(`${sessionTokenName}=abc123`);
    expect(capturedCookieHeader!).toContain(`${sessionDataName}=xyz789`);
  });

  test("setAll() receives parsed Set-Cookie headers from guestlist responses", async () => {
    const email = uniqueEmail("adapter");
    const password = "Adapter1234!@#$";
    const received: Array<{ name: string; value: string; options?: CookieSerializeOptions }> = [];

    // First sign the user up and auto-verify via the helper so sign-in produces
    // session_token + session_data Set-Cookies on guestlist's response.
    await signUpVerified({ name: "Adapter User", email, password });

    const client = createGuestlistClient({
      baseURL: "http://localhost",
      fetchOptions: {
        customFetchImpl: ((input, init) => SELF.fetch(input, init)) as typeof fetch,
      },
      cookies: {
        getAll: () => [],
        setAll: (cookies) => {
          received.push(...cookies);
        },
      },
    });

    const res = await client.auth.signIn.email({
      email,
      password,
      fetchOptions: { headers: { Origin: GUESTLIST_DEV_ORIGIN } },
    });
    expect(res.data).not.toBeNull();

    // Cookie names may carry the `__Secure-` prefix depending on the test env's
    // transport security, but the underlying guestlist cookie names are stable.
    const names = received.map((c) => c.name);
    expect(names.some((n) => n.endsWith(sessionTokenName))).toBe(true);
    expect(names.some((n) => n.endsWith(sessionDataName))).toBe(true);
    const token = received.find((c) => c.name.endsWith(sessionTokenName));
    expect(token?.value).toBeTruthy();
    expect(token?.options).toBeDefined();
  });

  test("cookies adapter off: no getAll, no setAll, no crash", async () => {
    // Back-compat: pre-adapter callers (onRequest for cookies) still work.
    const client = createGuestlistClient({
      baseURL: "http://localhost",
      fetchOptions: {
        customFetchImpl: ((input, init) => SELF.fetch(input, init)) as typeof fetch,
      },
    });
    const res = await client.auth.getSession();
    // Unauthed (no cookies wired) — null is fine; just confirming it doesn't throw.
    expect(res).toBeDefined();
  });
});

describe("createGuestlistClient guardrails", () => {
  test("throws when called in a browser environment", async () => {
    const { createGuestlistClient } = await import("../../src/client/guestlist");
    // @ts-expect-error — simulate window
    globalThis.window = {};
    try {
      expect(() => createGuestlistClient({ baseURL: "http://guestlist.test" })).toThrow(
        /server-only/,
      );
    } finally {
      // @ts-expect-error — cleanup
      delete globalThis.window;
    }
  });
});
