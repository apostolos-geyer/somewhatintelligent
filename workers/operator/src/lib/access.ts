import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import { err, ok } from "@si/contracts/result";
import type { DomainResult, OperatorAccessConfig, OperatorActor } from "@si/contracts";

import type { OperatorEnv } from "../operator-env";

export type AccessError = "unauthorized" | "misconfigured";

/**
 * Read the Access application config from env, or `null` when it is incomplete.
 * Both values are required together in deployed environments.
 */
export function readAccessConfig(env: OperatorEnv): OperatorAccessConfig | null {
  if (!env.POLICY_AUD || !env.TEAM_DOMAIN) return null;
  return { teamDomain: env.TEAM_DOMAIN, policyAud: env.POLICY_AUD };
}

// One remote JWKS resolver per team domain per isolate: createRemoteJWKSet
// keeps its own key cache and fetch cooldown, so reusing the instance avoids
// re-fetching `${teamDomain}/cdn-cgi/access/certs` on every request.
const remoteJwksByTeamDomain = new Map<string, JWTVerifyGetKey>();

function remoteJwksFor(teamDomain: string): JWTVerifyGetKey {
  let jwks = remoteJwksByTeamDomain.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    remoteJwksByTeamDomain.set(teamDomain, jwks);
  }
  return jwks;
}

/**
 * Verify an Access application JWT and derive the actor from its claims.
 * Signature (via the supplied JWKS resolver), issuer (exactly the team
 * domain), audience (the application AUD), and expiry are all enforced; any
 * failure — malformed, bad signature, wrong issuer/audience, expired — maps
 * to `unauthorized` so the caller fails closed with 403. Tests inject a local
 * JWKS resolver so verification never touches the network.
 */
export async function verifyAccessToken(
  token: string,
  config: OperatorAccessConfig,
  getKey: JWTVerifyGetKey,
): Promise<DomainResult<OperatorActor, "unauthorized">> {
  try {
    const { payload } = await jwtVerify(token, getKey, {
      issuer: config.teamDomain,
      audience: config.policyAud,
    });
    const { sub, email } = payload;
    if (typeof sub !== "string" || sub.length === 0) {
      return err("unauthorized", "Access token is missing the sub claim");
    }
    if (typeof email !== "string" || email.length === 0) {
      return err("unauthorized", "Access token is missing the email claim");
    }
    return ok({ sub, email });
  } catch {
    return err("unauthorized", "Access token failed verification");
  }
}

/**
 * Resolve the operator for a request, failing CLOSED (RFC-0001 D6/D7,
 * INV-ACCESS-1 / INV-ACCESS-2):
 *
 * - **development** — the fixed `DEV_OPERATOR` (only when
 *   `ENVIRONMENT === "development"`). Staging and production never fall back to it.
 * - **staging / production** — a valid Access application JWT is required.
 *   Missing configuration is a misconfiguration (the caller returns `500`); a
 *   missing or invalid token is `unauthorized` (the caller returns `403`).
 *
 * `getKey` defaults to the team domain's remote JWKS resolver; callers
 * (tests) may inject any jose key resolver.
 */
export async function resolveOperator(
  request: Request,
  env: OperatorEnv,
  getKey?: JWTVerifyGetKey,
): Promise<DomainResult<OperatorActor, AccessError>> {
  if (env.ENVIRONMENT === "development") {
    const dev = env.DEV_OPERATOR;
    if (dev) {
      const sep = dev.indexOf(":");
      if (sep > 0) {
        return ok({ sub: dev.slice(0, sep), email: dev.slice(sep + 1) });
      }
    }
    return ok({ sub: "dev-operator", email: "operator@localhost" });
  }

  const config = readAccessConfig(env);
  if (!config) return err("misconfigured", "POLICY_AUD/TEAM_DOMAIN not configured");

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return err("unauthorized", "missing Access assertion");

  return verifyAccessToken(token, config, getKey ?? remoteJwksFor(config.teamDomain));
}
