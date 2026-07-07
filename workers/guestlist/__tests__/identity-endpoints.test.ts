import { env, SELF } from "cloudflare:test";
import {
  signUpVerified,
  signUpAdmin,
  uniqueEmail,
  createOAuthClient,
  createOAuthConsent,
  createOAuthAccessToken,
  GUESTLIST_DEV_ORIGIN,
} from "./helpers";

describe("Identity App Endpoints", () => {
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

  // ── Admin endpoints ────────────────────────────────────────────────

  describe("GET /admin/stats", () => {
    test("admin gets stats with counts", async () => {
      const res = await SELF.fetch("http://localhost/admin/stats", {
        headers: { Cookie: adminCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        users: number;
        sessions: number;
        clients: number;
      };
      expect(typeof body.users).toBe("number");
      expect(typeof body.sessions).toBe("number");
      expect(typeof body.clients).toBe("number");
      expect(body.users).toBeGreaterThanOrEqual(2); // admin + regular
    });

    test("non-admin user is forbidden", async () => {
      const res = await SELF.fetch("http://localhost/admin/stats", {
        headers: { Cookie: userCookies },
      });
      expect(res.status).not.toBe(200);
    });

    test("unauthenticated request is unauthorized", async () => {
      const res = await SELF.fetch("http://localhost/admin/stats");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /admin/sessions", () => {
    test("admin gets sessions joined with user info", async () => {
      const res = await SELF.fetch("http://localhost/admin/sessions", {
        headers: { Cookie: adminCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        sessions: Array<{
          id: string;
          userId: string;
          userName: string | null;
          userEmail: string | null;
          createdAt: number;
          expiresAt: number;
        }>;
      };
      expect(Array.isArray(body.sessions)).toBe(true);
      expect(body.sessions.length).toBeGreaterThan(0);
      const first = body.sessions[0]!;
      expect(first).toHaveProperty("id");
      expect(first).toHaveProperty("userId");
      expect(first).toHaveProperty("userName");
      expect(first).toHaveProperty("userEmail");
    });

    test("non-admin user is forbidden", async () => {
      const res = await SELF.fetch("http://localhost/admin/sessions", {
        headers: { Cookie: userCookies },
      });
      expect(res.status).not.toBe(200);
    });

    test("unauthenticated request is unauthorized", async () => {
      const res = await SELF.fetch("http://localhost/admin/sessions");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /admin/api-keys", () => {
    test("admin gets api keys with owner email", async () => {
      // Create an API key via the auth client plugin endpoint
      const createRes = await SELF.fetch("http://localhost/api/auth/api-key/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: GUESTLIST_DEV_ORIGIN,
          Cookie: userCookies,
        },
        body: JSON.stringify({ name: "Test Key", prefix: "test" }),
      });
      expect(createRes.status).toBe(200);

      const res = await SELF.fetch("http://localhost/admin/api-keys", {
        headers: { Cookie: adminCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        apiKeys: Array<{
          id: string;
          name: string | null;
          prefix: string | null;
          enabled: boolean;
          ownerEmail: string | null;
        }>;
      };
      expect(Array.isArray(body.apiKeys)).toBe(true);
      const testKey = body.apiKeys.find((k) => k.name === "Test Key");
      expect(testKey).toBeDefined();
      expect(testKey!.ownerEmail).toBeTruthy();
    });

    test("non-admin user is forbidden", async () => {
      const res = await SELF.fetch("http://localhost/admin/api-keys", {
        headers: { Cookie: userCookies },
      });
      expect(res.status).not.toBe(200);
    });
  });

  describe("GET /admin/clients/:id", () => {
    test("admin gets single client with token and consent counts", async () => {
      const { id, clientId } = await createOAuthClient({
        name: "Detail Test Client",
        redirectUris: ["https://app.example.com/callback"],
      });

      await createOAuthAccessToken({ clientId, userId, scopes: ["openid"] });
      await createOAuthAccessToken({ clientId, userId, scopes: ["openid"] });
      await createOAuthConsent({ clientId, userId, scopes: ["openid"] });

      const res = await SELF.fetch(`http://localhost/admin/clients/${id}`, {
        headers: { Cookie: adminCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        client: { id: string; clientId: string; name: string | null };
        tokenCount: number;
        consentCount: number;
      };
      expect(body.client.id).toBe(id);
      expect(body.client.clientId).toBe(clientId);
      expect(body.tokenCount).toBe(2);
      expect(body.consentCount).toBe(1);
    });

    test("admin on nonexistent id errors", async () => {
      const res = await SELF.fetch("http://localhost/admin/clients/nonexistent-id", {
        headers: { Cookie: adminCookies },
      });
      expect(res.status).not.toBe(200);
    });

    test("non-admin user is forbidden", async () => {
      const { id } = await createOAuthClient({
        name: "Forbidden Test Client",
        redirectUris: ["https://app.example.com/callback"],
      });
      const res = await SELF.fetch(`http://localhost/admin/clients/${id}`, {
        headers: { Cookie: userCookies },
      });
      expect(res.status).not.toBe(200);
    });
  });

  // ── User endpoints ─────────────────────────────────────────────────

  describe("GET /user/connections", () => {
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

      const res = await SELF.fetch("http://localhost/user/connections", {
        headers: { Cookie: userCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        connections: Array<{
          consentId: string;
          clientId: string;
          clientName: string | null;
          scopes: string[] | string;
        }>;
      };
      expect(Array.isArray(body.connections)).toBe(true);
      const found = body.connections.find((c) => c.consentId === consentId);
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
        userId: adminUserId, // belongs to admin, not the regular user
        scopes: ["openid"],
      });

      const res = await SELF.fetch("http://localhost/user/connections", {
        headers: { Cookie: userCookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        connections: Array<{ consentId: string }>;
      };
      const found = body.connections.find((c) => c.consentId === otherConsentId);
      expect(found).toBeUndefined();
    });

    test("unauthenticated request is unauthorized", async () => {
      const res = await SELF.fetch("http://localhost/user/connections");
      expect(res.status).toBe(401);
    });
  });
});
