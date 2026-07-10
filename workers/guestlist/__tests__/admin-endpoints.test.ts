/**
 * Donor's identity-app-endpoints suite (admin stats/sessions/api-keys/
 * clients + user connections), ported to the RPC surface those routes
 * became.
 */
import { env, SELF } from "cloudflare:test";
import {
  signUpVerified,
  signUpAdmin,
  uniqueEmail,
  createOAuthClient,
  createOAuthConsent,
  createOAuthAccessToken,
  GUESTLIST_ORIGIN,
} from "./helpers";

let adminCookies: string;
let adminUserId: string;
let userCookies: string;
let userId: string;

beforeAll(async () => {
  const admin = await signUpAdmin({
    name: "Admin User",
    email: uniqueEmail("admin"),
    password: "Admin1234!@#$",
  });
  adminCookies = admin.cookies;
  adminUserId = admin.userId;

  const regular = await signUpVerified({
    name: "Regular User",
    email: uniqueEmail("user"),
    password: "User1234!@#$",
  });
  userCookies = regular.cookies;
  userId = regular.userId;
});

describe("adminStats", () => {
  test("admin gets counts", async () => {
    const res = await env.GL_RPC.adminStats({ cookie: adminCookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(typeof res.users).toBe("number");
    expect(typeof res.sessions).toBe("number");
    expect(typeof res.clients).toBe("number");
    expect(res.users).toBeGreaterThanOrEqual(2); // admin + regular
  });

  test("non-admin forbidden; unauthenticated unauthorized", async () => {
    expect(await env.GL_RPC.adminStats({ cookie: userCookies })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await env.GL_RPC.adminStats({ cookie: "" })).toEqual({
      ok: false,
      error: "unauthorized",
    });
  });
});

describe("adminListSessions", () => {
  test("admin gets sessions joined with user info", async () => {
    const res = await env.GL_RPC.adminListSessions({ cookie: adminCookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.sessions.length).toBeGreaterThan(0);
    const first = res.sessions[0]!;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("userId");
    expect(first).toHaveProperty("userName");
    expect(first).toHaveProperty("userEmail");
  });

  test("non-admin forbidden", async () => {
    expect(await env.GL_RPC.adminListSessions({ cookie: userCookies })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("adminListApiKeys", () => {
  test("admin sees keys with owner email (key created via BA HTTP plugin route)", async () => {
    const createRes = await SELF.fetch("http://localhost/api/auth/api-key/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_ORIGIN,
        Cookie: userCookies,
      },
      body: JSON.stringify({ name: "Test Key", prefix: "test" }),
    });
    expect(createRes.status).toBe(200);

    const res = await env.GL_RPC.adminListApiKeys({ cookie: adminCookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    const testKey = res.apiKeys.find((k) => k.name === "Test Key");
    expect(testKey).toBeDefined();
    expect(testKey!.ownerEmail).toBeTruthy();
  });

  test("non-admin forbidden", async () => {
    expect(await env.GL_RPC.adminListApiKeys({ cookie: userCookies })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("adminGetClient", () => {
  test("admin gets a client with token and consent counts", async () => {
    const { id, clientId } = await createOAuthClient({
      name: "Detail Test Client",
      redirectUris: ["https://app.example.com/callback"],
    });
    await createOAuthAccessToken({ clientId, userId, scopes: ["openid"] });
    await createOAuthAccessToken({ clientId, userId, scopes: ["openid"] });
    await createOAuthConsent({ clientId, userId, scopes: ["openid"] });

    const res = await env.GL_RPC.adminGetClient({ cookie: adminCookies, id });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.client.id).toBe(id);
    expect(res.client.clientId).toBe(clientId);
    expect(res.tokenCount).toBe(2);
    expect(res.consentCount).toBe(1);
  });

  test("nonexistent id reports not_found", async () => {
    expect(await env.GL_RPC.adminGetClient({ cookie: adminCookies, id: "nonexistent-id" })).toEqual(
      { ok: false, error: "not_found" },
    );
  });

  test("non-admin forbidden", async () => {
    const { id } = await createOAuthClient({
      name: "Forbidden Test Client",
      redirectUris: ["https://app.example.com/callback"],
    });
    expect(await env.GL_RPC.adminGetClient({ cookie: userCookies, id })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });
});

describe("adminDeleteClient", () => {
  test("managed clients are refused", async () => {
    const { id } = await createOAuthClient({
      name: "Managed Client",
      redirectUris: ["https://app.example.com/callback"],
      referenceId: "managed:identity",
    });
    const res = await env.GL_RPC.adminDeleteClient({ cookie: adminCookies, id });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("managed_client");
  });
});

describe("getConnections", () => {
  test("user gets their own consents joined with client names", async () => {
    const { clientId } = await createOAuthClient({
      name: "Connections Test Client",
      redirectUris: ["https://app.example.com/callback"],
    });
    const { id: consentId } = await createOAuthConsent({
      clientId,
      userId,
      scopes: ["openid", "email"],
    });

    const res = await env.GL_RPC.getConnections({ cookie: userCookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    const found = res.connections.find((c) => c.consentId === consentId);
    expect(found).toBeDefined();
    expect(found!.clientName).toBe("Connections Test Client");
    expect(found!.clientId).toBe(clientId);
  });

  test("user does not see other users' consents", async () => {
    const { clientId } = await createOAuthClient({
      name: "Other User Client",
      redirectUris: ["https://app.example.com/callback"],
    });
    const { id: otherConsentId } = await createOAuthConsent({
      clientId,
      userId: adminUserId,
      scopes: ["openid"],
    });

    const res = await env.GL_RPC.getConnections({ cookie: userCookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.connections.find((c) => c.consentId === otherConsentId)).toBeUndefined();
  });

  test("unauthenticated is unauthorized", async () => {
    expect(await env.GL_RPC.getConnections({ cookie: "" })).toEqual({
      ok: false,
      error: "unauthorized",
    });
  });
});
