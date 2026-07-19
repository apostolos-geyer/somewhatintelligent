import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import type { JWTVerifyGetKey, KeyLike } from "jose";

import { resolveOperator } from "../src/lib/access";
import type { OperatorEnv } from "../src/operator-env";

// Access-middleware suite (RFC-0001 D6, INV-ACCESS-1/2). Tokens are minted
// in-test from an ephemeral RSA keypair and verified through a LOCAL jose JWKS
// resolver injected into resolveOperator — the production remote-JWKS path
// (`${teamDomain}/cdn-cgi/access/certs`) is never touched, so no network.

const TEAM_DOMAIN = "https://somewhatintelligent.cloudflareaccess.com";
const POLICY_AUD = "9f0a1b2c3d4e5f60718293a4b5c6d7e8";
const OPERATOR_URL = "https://desk.staging.somewhatintelligent.ca";

let privateKey: KeyLike;
let jwks: JWTVerifyGetKey;
let foreignPrivateKey: KeyLike;

interface TokenOptions {
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  sub?: string;
  email?: string;
  key?: KeyLike;
}

function signToken({
  issuer = TEAM_DOMAIN,
  audience = POLICY_AUD,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  sub = "access-sub-123",
  email = "apostoli@example.com",
  key = privateKey,
}: TokenOptions = {}): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "RS256" })
    .setSubject(sub)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

function makeEnv(overrides: Partial<OperatorEnv> = {}): OperatorEnv {
  return {
    ENVIRONMENT: "staging",
    OPERATOR_URL,
    POLICY_AUD,
    TEAM_DOMAIN,
    ...overrides,
  };
}

function makeRequest(token?: string): Request {
  const headers = new Headers();
  if (token !== undefined) headers.set("Cf-Access-Jwt-Assertion", token);
  return new Request(OPERATOR_URL, { headers });
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [await exportJWK(pair.publicKey)] });
  foreignPrivateKey = (await generateKeyPair("RS256")).privateKey;
});

describe("development", () => {
  test("resolves the DEV_OPERATOR sub and email", async () => {
    const env = makeEnv({
      ENVIRONMENT: "development",
      DEV_OPERATOR: "dev-sub-1:operator@somewhatintelligent.localhost",
      POLICY_AUD: undefined,
      TEAM_DOMAIN: undefined,
    });
    const result = await resolveOperator(makeRequest(), env);
    expect(result).toEqual({
      ok: true,
      value: { sub: "dev-sub-1", email: "operator@somewhatintelligent.localhost" },
    });
  });

  test("falls back to the fixed dev actor when DEV_OPERATOR is unset", async () => {
    const env = makeEnv({
      ENVIRONMENT: "development",
      DEV_OPERATOR: undefined,
      POLICY_AUD: undefined,
      TEAM_DOMAIN: undefined,
    });
    const result = await resolveOperator(makeRequest(), env);
    expect(result).toEqual({
      ok: true,
      value: { sub: "dev-operator", email: "operator@localhost" },
    });
  });
});

describe("deployed environments (staging/production)", () => {
  test("missing POLICY_AUD/TEAM_DOMAIN is misconfigured (500 path)", async () => {
    const env = makeEnv({ POLICY_AUD: undefined, TEAM_DOMAIN: undefined });
    const result = await resolveOperator(makeRequest(), env, jwks);
    expect(result).toMatchObject({ ok: false, error: "misconfigured" });
  });

  test("a missing token is unauthorized (403 path)", async () => {
    const result = await resolveOperator(makeRequest(), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("a garbage token is unauthorized", async () => {
    const result = await resolveOperator(makeRequest("not-a-jwt"), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("an expired token is unauthorized", async () => {
    const token = await signToken({ expiresAt: Math.floor(Date.now() / 1000) - 3600 });
    const result = await resolveOperator(makeRequest(token), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("a wrong-issuer token is unauthorized", async () => {
    const token = await signToken({ issuer: "https://attacker.cloudflareaccess.com" });
    const result = await resolveOperator(makeRequest(token), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("a wrong-audience token is unauthorized", async () => {
    const token = await signToken({ audience: "00000000000000000000000000000000" });
    const result = await resolveOperator(makeRequest(token), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("a token signed by a foreign key is unauthorized", async () => {
    const token = await signToken({ key: foreignPrivateKey });
    const result = await resolveOperator(makeRequest(token), makeEnv(), jwks);
    expect(result).toMatchObject({ ok: false, error: "unauthorized" });
  });

  test("a valid token resolves the sub and email claims", async () => {
    const token = await signToken({ sub: "access-sub-9", email: "apostoli@example.com" });
    const result = await resolveOperator(makeRequest(token), makeEnv(), jwks);
    expect(result).toEqual({
      ok: true,
      value: { sub: "access-sub-9", email: "apostoli@example.com" },
    });
  });

  test("production never falls back to DEV_OPERATOR", async () => {
    const env = makeEnv({
      ENVIRONMENT: "production",
      OPERATOR_URL: "https://desk.somewhatintelligent.ca",
      DEV_OPERATOR: "dev-sub-1:operator@somewhatintelligent.localhost",
      POLICY_AUD: undefined,
      TEAM_DOMAIN: undefined,
    });
    const result = await resolveOperator(makeRequest(), env, jwks);
    expect(result).toMatchObject({ ok: false, error: "misconfigured" });

    // And with config present, a valid token wins — the dev actor is ignored.
    const configured = makeEnv({
      ENVIRONMENT: "production",
      OPERATOR_URL: "https://desk.somewhatintelligent.ca",
      DEV_OPERATOR: "dev-sub-1:operator@somewhatintelligent.localhost",
    });
    const token = await signToken({ sub: "access-sub-prod" });
    const resolved = await resolveOperator(makeRequest(token), configured, jwks);
    expect(resolved).toMatchObject({ ok: true, value: { sub: "access-sub-prod" } });
  });
});
