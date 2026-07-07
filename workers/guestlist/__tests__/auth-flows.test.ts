import { SELF } from "cloudflare:test";
import {
  signUpVerified,
  extractCookies,
  uniqueEmail,
  GUESTLIST_DEV_ORIGIN,
  COOKIE_PREFIX,
} from "./helpers";

const sessionDataName = `${COOKIE_PREFIX}.session_data`;
const sessionDataRe = new RegExp(`${COOKIE_PREFIX}\\.session_data=([^;]+)`);

describe("Auth Flows", () => {
  const email = uniqueEmail("auth");
  const password = "Test1234!@#$";
  const name = "Auth Flow User";
  let sessionCookies: string;

  beforeAll(async () => {
    const result = await signUpVerified({ name, email, password });
    sessionCookies = result.cookies;
  });

  test("sign-up creates a user and returns user data", async () => {
    const newEmail = uniqueEmail("signup");
    const res = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_DEV_ORIGIN,
      },
      body: JSON.stringify({
        name: "Signup Test",
        email: newEmail,
        password: "Password123!",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const user = body.user as Record<string, unknown> | undefined;
    expect(user).toBeDefined();
    expect(user!.email).toBe(newEmail);
    expect(user!.name).toBe("Signup Test");
  });

  test("sign-in returns session cookies", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_DEV_ORIGIN,
      },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(200);
    const cookies = extractCookies(res);
    expect(cookies).toContain(sessionDataName);
  });

  test("get-session returns user data with valid cookies", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/get-session", {
      headers: { Cookie: sessionCookies },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    const user = body.user as Record<string, unknown>;
    expect(user).toBeDefined();
    expect(user.email).toBe(email);
    expect(user.name).toBe(name);
  });

  test("tampered cookies are rejected", async () => {
    const tampered = sessionCookies.replace(
      new RegExp(`${COOKIE_PREFIX}\\.session_data=[^;]+`),
      `${sessionDataName}=tampered.invalid.value`,
    );
    const res = await SELF.fetch("http://localhost/api/auth/get-session", {
      headers: { Cookie: tampered },
    });
    // Better Auth returns null session (200 with null body) or 401
    const body = (await res.json()) as Record<string, unknown> | null;
    const isRejected = res.status === 401 || !body || body.user === null || body.session === null;
    expect(isRejected).toBe(true);
  });

  test("cookie cache JWT payload contains expected fields", () => {
    const match = sessionCookies.match(sessionDataRe);
    expect(match).not.toBeNull();
    const token = match![1]!;

    // JWT is base64url-encoded: header.payload.signature
    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;

    expect(payload).toHaveProperty("session");
    expect(payload).toHaveProperty("user");

    const user = payload.user as Record<string, unknown>;
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("email");
    expect(user).toHaveProperty("role");
  });
});
