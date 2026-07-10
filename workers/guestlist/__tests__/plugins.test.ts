import { SELF } from "cloudflare:test";

describe("Plugin Compatibility", () => {
  test("JWT: GET /api/auth/jwks returns valid JWKS", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/jwks");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keys: unknown[] };
    expect(body).toHaveProperty("keys");
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.keys.length).toBeGreaterThanOrEqual(1);
    const key = body.keys[0] as Record<string, unknown>;
    expect(key).toHaveProperty("kty");
    expect(key).toHaveProperty("kid");
  });

  test("OIDC: GET /.well-known/openid-configuration returns discovery doc", async () => {
    const res = await SELF.fetch("http://localhost/.well-known/openid-configuration");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("issuer");
    expect(body).toHaveProperty("authorization_endpoint");
    expect(body).toHaveProperty("token_endpoint");
    expect(body).toHaveProperty("jwks_uri");
  });
});
