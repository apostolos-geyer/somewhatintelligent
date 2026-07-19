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
 * SCAFFOLD (exec-plan 0004 track T2). The JWT verification is stubbed — track
 * **T3** implements `Cf-Access-Jwt-Assertion` validation against the team JWKS,
 * issuer, and audience (via `jose`) and derives the `OperatorActor` from the
 * verified `sub`/`email` claims. Until then this returns `unauthorized` outside
 * development, so the worker is never open by accident.
 */
export async function resolveOperator(
  request: Request,
  env: OperatorEnv,
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

  // TODO(T3): verify `token` with the team JWKS at
  // `${config.teamDomain}/cdn-cgi/access/certs`, checking issuer
  // (`config.teamDomain`), audience (`config.policyAud`), and expiry via `jose`,
  // then return ok({ sub, email }) from the verified claims.
  void config;
  return err("unauthorized", "Access JWT verification not yet implemented (RFC-0001 T3)");
}
