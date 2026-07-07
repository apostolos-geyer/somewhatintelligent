import { SELF } from "cloudflare:test";
import {
  signUpVerified,
  extractCookies,
  getRawSetCookies,
  uniqueEmail,
  GUESTLIST_DEV_ORIGIN,
  COOKIE_PREFIX,
} from "./helpers";

// Wire cookie names derive from the configured prefix; the session_token /
// session_data suffixes are better-auth's own and stay literal.
const sessionDataName = `${COOKIE_PREFIX}.session_data`;
const sessionDataRe = new RegExp(`${COOKIE_PREFIX}\\.session_data=([^;]+)`);

describe("SSO Cookie Behavior", () => {
  const email = uniqueEmail("cookie");
  const password = "Cookie1234!@#$";
  let signInResponse: Response;
  let sessionCookies: string;

  beforeAll(async () => {
    await signUpVerified({ name: "Cookie User", email, password });

    signInResponse = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_DEV_ORIGIN,
      },
      body: JSON.stringify({ email, password }),
    });
    sessionCookies = extractCookies(signInResponse);
  });

  test("cookie domain is set for cross-subdomain SSO", () => {
    const rawCookies = getRawSetCookies(signInResponse);
    const sessionDataCookie = rawCookies.find((c) => c.includes(sessionDataName));
    expect(sessionDataCookie).toBeDefined();
    expect(sessionDataCookie!.toLowerCase()).toMatch(/domain=/);
  });

  test(`cookie prefix is '${COOKIE_PREFIX}'`, () => {
    // BA prepends `__Secure-` when baseURL is https — accept either form.
    const rawCookies = getRawSetCookies(signInResponse);
    const sessionCookie = rawCookies.find((c) =>
      new RegExp(`^(__Secure-)?${COOKIE_PREFIX}\\.session_data=`).test(c),
    );
    expect(sessionCookie).toBeDefined();
    const tokenCookie = rawCookies.find((c) =>
      new RegExp(`^(__Secure-)?${COOKIE_PREFIX}\\.session_(token|data)=`).test(c),
    );
    expect(tokenCookie).toBeDefined();
  });

  test("cookie cache is a JWT with HS256 strategy", () => {
    const match = sessionCookies.match(sessionDataRe);
    expect(match).not.toBeNull();
    const token = match![1]!;

    const parts = token.split(".");
    expect(parts.length).toBe(3);

    const header = JSON.parse(atob(parts[0]!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;
    expect(header.alg).toBe("HS256");
  });

  test("cookie payload includes role from user.additionalFields", () => {
    const match = sessionCookies.match(sessionDataRe);
    expect(match).not.toBeNull();
    const token = match![1]!;
    const parts = token.split(".");

    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;

    const user = payload.user as Record<string, unknown>;
    expect(user).toBeDefined();
    expect(user).toHaveProperty("role");
    expect(user.role).toBe("user");
  });
});
